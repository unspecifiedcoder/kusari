import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ProductNavigation, ProductHeader } from "@/components/ProductNavigation";

export const metadata: Metadata = {
  title: "Kusari · Onchain boundaries for AI agents",
  description: "Inspect a live ENS policy, verify guarded Uniswap v4 trades, and watch an agent's authority being revoked on Sepolia.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body>
        <Providers>
          <a className="skip-link" href="#main-content">Skip to main content</a>
          <div className="app-shell">
            <ProductNavigation />
            <div className="app-body">
              <ProductHeader />
              <main id="main-content" tabIndex={-1} className="app-content">{children}</main>
              <footer className="app-footer"><span>ETHGlobal Mumbai 2026</span><span>Sepolia · Test tokens only</span></footer>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
