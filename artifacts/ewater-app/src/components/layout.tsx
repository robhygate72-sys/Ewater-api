import { Link, useLocation } from "wouter";
import { Home, Droplet, ChevronLeft, LogOut, RefreshCw, Star, Bell, Tag, Gauge } from "lucide-react";
import { ReactNode, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useLogout } from "@/App";
import { useQueryClient } from "@tanstack/react-query";

interface LayoutProps {
  children: ReactNode;
  title?: string;
  showBack?: boolean;
  backTo?: string;
  headerActions?: ReactNode;
  /** Relax the mobile max-width for data-dense pages like the HHC dashboard. */
  wide?: boolean;
}

export function Layout({ children, title, showBack, backTo, headerActions, wide }: LayoutProps) {
  const [location] = useLocation();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries();
    setIsRefreshing(false);
  }, [queryClient]);

  const navItems = [
    { href: "/", icon: Home, label: "Dashboard" },
    { href: "/assets", icon: Droplet, label: "Assets" },
    { href: "/tags", icon: Tag, label: "Tags" },
    { href: "/watchlist", icon: Star, label: "Watchlist" },
    { href: "/notifications", icon: Bell, label: "Alerts" },
    { href: "/hhc", icon: Gauge, label: "HHC" },
  ];

  return (
    <div className="flex flex-col min-h-[100dvh] bg-background text-foreground pb-safe">
      <header className="sticky top-0 z-10 bg-primary text-primary-foreground shadow-md h-14 flex items-center px-4 shrink-0">
        {showBack ? (
          <Link href={backTo || "/"} className="mr-3 p-1 -ml-1 rounded-full hover:bg-primary-foreground/10 transition-colors">
            <ChevronLeft className="w-6 h-6" />
          </Link>
        ) : null}
        <h1 className="text-lg font-semibold tracking-tight truncate flex-1">{title || "eWater Monitor"}</h1>
        {headerActions}
        <button
          onClick={handleRefresh}
          className="p-2 rounded-full hover:bg-primary-foreground/10 transition-colors"
          title="Refresh data"
          disabled={isRefreshing}
        >
          <RefreshCw className={cn("w-5 h-5", isRefreshing && "animate-spin")} />
        </button>
        <button
          onClick={logout}
          className="p-2 -mr-1 rounded-full hover:bg-primary-foreground/10 transition-colors"
          title="Sign out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className={cn("flex-1 flex flex-col p-4 w-full mx-auto overflow-x-hidden pb-20", wide ? "max-w-5xl" : "max-w-md")}>
        {children}
      </main>

      {!showBack && (
        <nav className="fixed bottom-0 w-full bg-card border-t border-border flex items-center justify-around h-16 pb-safe z-20 px-2 max-w-md left-1/2 -translate-x-1/2">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center w-full h-full space-y-1 rounded-lg transition-colors",
                  isActive ? "text-primary font-medium" : "text-muted-foreground hover:bg-muted"
                )}
              >
                <item.icon className={cn("w-5 h-5", isActive ? "stroke-[2.5px]" : "")} />
                <span className="text-[10px]">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
