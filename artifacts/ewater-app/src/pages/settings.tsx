import { Layout } from "@/components/layout";
import { useGetCredentialsStatus, useSaveCredentials, useClearCredentials, getGetCredentialsStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ShieldAlert, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: status, isLoading: isLoadingStatus } = useGetCredentialsStatus();
  
  const saveMutation = useSaveCredentials();
  const clearMutation = useClearCredentials();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    saveMutation.mutate({ data: values }, {
      onSuccess: () => {
        toast({
          title: "Connected",
          description: "Successfully signed in to eWater.",
        });
        queryClient.invalidateQueries({ queryKey: getGetCredentialsStatusQueryKey() });
        form.reset();
      },
      onError: (error: any) => {
        toast({
          title: "Sign-in failed",
          description: error?.response?.data?.error || error?.message || "Failed to connect. Check your username and password.",
          variant: "destructive",
        });
      }
    });
  }

  function onClear() {
    clearMutation.mutate(undefined, {
      onSuccess: () => {
        toast({
          title: "Signed Out",
          description: "Disconnected from eWater.",
        });
        queryClient.invalidateQueries({ queryKey: getGetCredentialsStatusQueryKey() });
      }
    });
  }

  return (
    <Layout title="Settings">
      <div className="space-y-6">
        {/* Status Indicator */}
        <Card className={cn(
          "border shadow-sm",
          status?.isConfigured ? "border-emerald-500/50 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/5"
        )}>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isLoadingStatus ? (
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              ) : status?.isConfigured ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              ) : (
                <ShieldAlert className="w-6 h-6 text-amber-500" />
              )}
              <div>
                <h3 className="font-semibold text-sm">Connection Status</h3>
                <p className="text-xs text-muted-foreground">
                  {isLoadingStatus 
                    ? "Checking..." 
                    : status?.isConfigured 
                      ? `Connected to ${status.environment || 'production'}` 
                      : "Not signed in"}
                </p>
              </div>
            </div>
            {status?.isConfigured && (
              <Badge variant="outline" className="bg-background text-[10px]">Active</Badge>
            )}
          </CardContent>
        </Card>

        {/* Login Form */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <KeyRound className="w-5 h-5" />
              eWater Sign In
            </CardTitle>
            <CardDescription>
              Sign in with your eWater account credentials to start monitoring.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter your eWater username"
                          autoCapitalize="none"
                          autoComplete="username"
                          {...field}
                          className="bg-background"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Enter your eWater password"
                          autoComplete="current-password"
                          {...field}
                          className="bg-background"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="pt-2 flex flex-col gap-2">
                  <Button type="submit" disabled={saveMutation.isPending} className="w-full">
                    {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Sign In
                  </Button>
                  
                  {status?.isConfigured && (
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={onClear}
                      disabled={clearMutation.isPending}
                      className="w-full text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
                    >
                      {clearMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                      Sign Out
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
