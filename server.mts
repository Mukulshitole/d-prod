import dotenv from "dotenv";
import Redis from "ioredis";
import { Db, Document, MongoClient, UpdateFilter } from "mongodb";
import next from "next";
import { createServer } from "node:http";
import { Server } from "socket.io";

dotenv.config();

// Document interfaces
interface MessageDocument {
  timestamp: string;
  question?: string;
  answer?: string;
}

interface ChatDocument extends Document {
  tenantId: string;
  uuid: string;
  messages: MessageDocument[];
}

// Message data interface
interface MessageData {
  room: string;
  message: string;
  sender: string;
  role?: string;
  type?: string;
  senderId: string;
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const redisConfig = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || "27613"),
  username: process.env.REDIS_USER,
  password: process.env.REDIS_PASS,
};

const MONGODB_URL = process.env.MONGODB_URL_2 || 'mongodb://localhost:27017';
const DB_NAME = 'Rag_doc';

// Initialize MongoDB client
const mongoClient = new MongoClient(MONGODB_URL);

// Connect to MongoDB
async function connectToMongo() {
  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB');
    return mongoClient.db(DB_NAME);
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

const pub = new Redis(redisConfig);
const sub = new Redis(redisConfig);

// Function to ensure the chat-messages channel exists
async function ensureChatMessagesChannel() {
  try {
    const channels = await pub.pubsub("CHANNELS");

    if (!channels.includes("chat-messages")) {
      console.log("Channel 'chat-messages' does not exist. Creating it now...");

      // Publish a dummy message to create the channel
      await pub.publish("chat-messages", JSON.stringify({ system: "Initializing chat-messages channel" }));
      console.log("Channel 'chat-messages' initialized.");
    } else {
      console.log("Channel 'chat-messages' already exists.");
    }
  } catch (error) {
    console.error("Error checking/creating chat-messages channel:", error);
  }
}

// Ensure the channel exists before subscribing
ensureChatMessagesChannel().then(() => {
  sub.subscribe("chat-messages", (err) => {
    if (err) {
      console.error("Failed to subscribe to chat-messages:", err);
      return;
    }
    console.log("Successfully subscribed to chat-messages channel");
  });
});

// Initialize MongoDB connection
let db: Db;
connectToMongo()
  .then(database => {
    db = database;
    console.log('MongoDB database initialized');
  })
  .catch(err => console.error('Failed to initialize MongoDB:', err));

// Function to store message in MongoDB
async function storeMessageInMongoDB(messageData: MessageData) {
  if (!db) {
    console.error('MongoDB not initialized');
    return;
  }

  try {
    const { room: uuid, message, sender: tenantId, role, type } = messageData;
    
    // Skip messages without a role
    if (!role) {
      console.log('Skipping message without role');
      return;
    }

    const collection = db.collection<ChatDocument>(tenantId);
    
    const messageDoc: MessageDocument = {
      timestamp: new Date().toISOString(),
      ...(role === 'admin' ? { answer: message } : { question: message })
    };

    const update: UpdateFilter<ChatDocument> = {
      $set: { tenantId, uuid },
      $push: { messages: messageDoc }
    }as any;

    await collection.updateOne(
      { tenantId, uuid },
      update,
      { upsert: true }
    );

    console.log(`Message stored in MongoDB for tenant ${tenantId}, room ${uuid}`);
  } catch (error) {
    console.error('Error storing message in MongoDB:', error);
  }
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(handle);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling'], // Move this to top level
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("join-room", ({ room, username, role }) => {
      socket.join(room);
      console.log(`${username} joined room: ${room} as ${role}`);
      socket.to(room).emit("user_joined", `${username} joined the room`);
    });

    // Handle message sending
    socket.on("message", async ({ room, message, sender, role, type = "text" }) => {
      console.log(`Message from ${sender} in room ${room} as ${role}: ${message}`);
    
      try {
        const messageData: MessageData = {
          room,
          message,
          sender,
          role,
          type,
          senderId: socket.id,
        };
    
        // Store directly in MongoDB
        await storeMessageInMongoDB(messageData);
        
        // Also publish to Redis for real-time updates
        await pub.publish("chat-messages", JSON.stringify(messageData));
        console.log("Message published to Redis and stored in MongoDB");
    
      } catch (error) {
        console.error("Error handling message:", error);
      }
    });

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });

  io.on("connection", (socket) => {
    console.log(`[${new Date().toISOString()}] Socket connection established - ID: ${socket.id} | IP: ${socket.handshake.address} | User Agent: ${socket.handshake.headers['user-agent']}`);
  });

  // Handle Redis messages for real-time communication
  sub.on("message", async (channel, message) => {
    if (channel === "chat-messages") {
      try {
        const parsedMessage = JSON.parse(message) as MessageData;
        
        // Emit to everyone in the room EXCEPT the sender
        io.to(parsedMessage.room)
          .except(parsedMessage.senderId)
          .emit("message", parsedMessage);
          
        if (parsedMessage.room) {
          console.log("New UUID event emitted:", {
            uuid: parsedMessage.room,
            sender: parsedMessage.sender,
            message: parsedMessage.message,
            role: parsedMessage.role,
            type: parsedMessage.type,
          });
          
          io.emit("new-user", {
            uuid: parsedMessage.room,
            sender: parsedMessage.sender,
            message: parsedMessage.message,
            role: parsedMessage.role,
            type: parsedMessage.type,
          });
        }
      } catch (error) {
        console.error("Error processing Redis message:", error);
      }
    }
  });

  httpServer.listen(port, () => {
    console.log(`Server running on http://${hostname}:${port}`);
  });
});

// Graceful shutdown handler
process.on('SIGTERM', async () => {
  console.log('Shutting down server...');
  try {
    await mongoClient.close();
    console.log('MongoDB connection closed');
  } catch (error) {
    console.error('Error during shutdown:', error);
  } finally {
    process.exit(0);
  }
});