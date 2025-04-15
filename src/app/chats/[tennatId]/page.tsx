"use client"; // Mark this as a client component

import { usePathname } from "next/navigation";
import ChatComponent from "../../../components/chat/ChatComponent";

export default function ChatPage() {
  const pathname = usePathname(); // Get the current path
  console.log("Pathname:", pathname); // Debugging

  // Extract tenantId from the path (e.g., /chats/666 => 666)
  const tenantId = pathname?.split("/")[5]; // Adjust the index based on your URL structure
  console.log("Tenant ID in page.tsx:", tenantId); // Debugging

  if (!tenantId) {
    return <div>Tenant ID is missing</div>; // Handle the case where tenantId is undefined
  }

  return (
    <div>
      <ChatComponent tenantId={tenantId} />
    </div>
  );
}