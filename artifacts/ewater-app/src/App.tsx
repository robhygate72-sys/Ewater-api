import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Assets from "@/pages/assets";
import AssetDetail from "@/pages/asset-detail";
import Login from "@/pages/login";
import { useGetCredentialsStatus, useClearCredentials, getGetCredentialsStatusQueryKey } from "@workspace/api-client-react";
import { Droplets } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: status, isLoading } = useGetCredentialsStatus();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center animate-pulse">
            <Droplets className="w-8 h-8 text-primary-foreground" />
          </div>
          <p className="text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (!status?.isConfigured) {
    return <Login />;
  }

  return <>{children}</>;
}

export function useLogout() {
  const qc = useQueryClient();
  const clearMutation = useClearCredentials();

  return () => {
    clearMutation.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetCredentialsStatusQueryKey() });
      },
    });
  };
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/assets" component={Assets} />
      <Route path="/assets/:id" component={AssetDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthGate>
            <Router />
          </AuthGate>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
