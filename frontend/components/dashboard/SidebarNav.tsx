"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ScanLine,
  ShieldAlert,
  Package,
  MapPin,
  Bot,
  Video,
} from "lucide-react";

const navItems = [
  { label: "Command Center", href: "/dashboard", icon: LayoutDashboard },
  { label: "Inventory Scanner", href: "/inventory", icon: ScanLine },
  { label: "Load Intelligence", href: "/dashboard/load", icon: Package },
  { label: "Damage Control", href: "/dashboard/damage", icon: ShieldAlert },
  { label: "Last-Mile Risk", href: "/dashboard/lastmile", icon: MapPin },
  { label: "Truck Flow", href: "/dashboard/traffic", icon: Video },
  { label: "Agent Monitor", href: "/dashboard/agents", icon: Bot },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-56 flex-col border-r border-border bg-sidebar shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-border">
        <div className="flex h-7 w-7 items-center justify-center bg-[#111113] border border-[#2a2a32]">
          <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="4" width="10" height="10" fill="#4d8eff" opacity="0.9" />
            <rect x="18" y="4" width="10" height="10" fill="#4d8eff" opacity="0.5" />
            <rect x="4" y="18" width="10" height="10" fill="#4d8eff" opacity="0.5" />
            <rect x="18" y="18" width="10" height="10" fill="#4d8eff" opacity="0.7" />
          </svg>
        </div>
        <span className="text-sm font-semibold tracking-tight">FleetLabs</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-[11px] text-muted-foreground">HackX 2026</p>
      </div>
    </aside>
  );
}
