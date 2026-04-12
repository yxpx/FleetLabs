"use client";

import dynamic from "next/dynamic";

const LeafletMap = dynamic(
  () => import("@/components/dashboard/LeafletMap"),
  { ssr: false, loading: () => <div className="w-full h-full bg-card/50 animate-pulse" /> }
);

export function ShipmentMap() {
  return (
    <div className="border border-border bg-card/50 h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <h3 className="text-[13px] font-semibold">Shipment Routes</h3>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 bg-[#4d8eff] inline-block" /> In Transit
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 bg-[#34d399] inline-block" /> Delivered
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 bg-[#e54545] inline-block" /> Delayed
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <LeafletMap />
      </div>
    </div>
  );
}
