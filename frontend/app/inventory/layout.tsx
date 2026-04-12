import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell>{children}</DashboardShell>;
}
