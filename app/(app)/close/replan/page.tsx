import { redirect } from "next/navigation";

// IA-P2: Today moved onto Home (Morning card -> Today strip -> Close the day). Old links and bookmarks land on Home.
export default function Page() {
  redirect("/");
}
