import type { Metadata } from "next";
import { SupportDesk } from "./support-desk";

export const metadata: Metadata = {
  title: "RelayDesk · Telegram Destek Merkezi",
  description: "Telegram özel sohbetlerini ve gruplarını tek ekip gelen kutusunda yönetin.",
};

export default function Home() {
  return <SupportDesk />;
}
