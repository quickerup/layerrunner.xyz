"use client";

import { TonConnectUIProvider } from "@tonconnect/ui-react";

export function TonConnectProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <TonConnectUIProvider manifestUrl="https://layerrunners.xyz/tonconnect-manifest.json">
      {children}
    </TonConnectUIProvider>
  );
}
