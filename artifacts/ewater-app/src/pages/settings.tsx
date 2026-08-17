import { Layout } from "@/components/layout";
import {
  useGetCredentialsStatus,
  useSaveCredentials,
  useClearCredentials,
  getGetCredentialsStatusQueryKey,
  useGetNotifierSettings,
  useUpdateNotifierSettings,
  useTestNotifier,
  getGetNotifierSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  ShieldAlert,
  KeyRound,
  Loader2,
  Trash2,
  Webhook,
  Plus,
  Send,
  Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

// ─── Credentials form ────────────────────────────────────────────────────────

const credSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

// ─── Notifier settings form ───────────────────────────────────────────────────

const systemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1, "Name is required"),
});

const notifierSchema = z.object({
  enabled: z.boolean(),
  webhookUrl: z
    .string()
    .refine((v) => v === "" || /^https?:\/\//.test(v), {
      message: "Must be an http(s):// URL or empty",
    }),
  refreshMinutes: z.number().int().min(5).max(1440),
  systems: z.array(systemSchema).min(1, "At least one system is required"),
});

type NotifierFormValues = z.infer<typeof notifierSchema>;

function formatLastRun(lastRunAt: string | null, lastResult: string | null): string {
  if (!lastRunAt) return "Never run";
  const d = new Date(lastRunAt);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = d.toLocaleDateString([], { day: "2-digit", month: "short" });
  const resultLabel =
    lastResult === "sent" ? "OK" : lastResult === "failed" ? "Failed" : "Skipped";
  return `Last ${date} ${time} · ${resultLabel}`;
}

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Credentials ────────────────────────────────────────────────────────────
  const { data: credStatus, isLoading: isLoadingStatus } = useGetCredentialsStatus();
  const saveMutation = useSaveCredentials();
  const clearMutation = useClearCredentials();

  const credForm = useForm<z.infer<typeof credSchema>>({
    resolver: zodResolver(credSchema),
    defaultValues: { username: "", password: "" },
  });

  function onCredSubmit(values: z.infer<typeof credSchema>) {
    saveMutation.mutate(
      { data: values },
      {
        onSuccess: () => {
          toast({ title: "Connected", description: "Successfully signed in to eWater." });
          queryClient.invalidateQueries({ queryKey: getGetCredentialsStatusQueryKey() });
          credForm.reset();
        },
        onError: (error: any) => {
          toast({
            title: "Sign-in failed",
            description:
              error?.response?.data?.error ||
              error?.message ||
              "Failed to connect. Check your username and password.",
            variant: "destructive",
          });
        },
      },
    );
  }

  function onClear() {
    clearMutation.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Signed Out", description: "Disconnected from eWater." });
        queryClient.invalidateQueries({ queryKey: getGetCredentialsStatusQueryKey() });
      },
    });
  }

  // ── Notifier settings ──────────────────────────────────────────────────────
  const { data: notifierData, isLoading: isLoadingNotifier } = useGetNotifierSettings();
  const updateNotifier = useUpdateNotifierSettings();
  const testNotifierMutation = useTestNotifier();

  const notifierForm = useForm<NotifierFormValues>({
    resolver: zodResolver(notifierSchema),
    defaultValues: {
      enabled: false,
      webhookUrl: "",
      refreshMinutes: 30,
      systems: [
        { id: 217, name: "Kajire" },
        { id: 218, name: "Sagalla" },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: notifierForm.control,
    name: "systems",
  });

  // Populate form when data arrives
  useEffect(() => {
    if (!notifierData) return;
    notifierForm.reset({
      enabled: notifierData.enabled ?? false,
      webhookUrl: notifierData.webhookUrl ?? "",
      refreshMinutes: notifierData.refreshMinutes ?? 30,
      systems: (notifierData.systems ?? []).map((s) => ({ id: Number(s.id), name: s.name })),
    });
  }, [notifierData]); // eslint-disable-line react-hooks/exhaustive-deps

  function onNotifierSubmit(values: NotifierFormValues) {
    updateNotifier.mutate(
      {
        data: {
          enabled: values.enabled,
          webhookUrl: values.webhookUrl,
          refreshMinutes: values.refreshMinutes,
          systems: values.systems,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Saved", description: "Webhook settings updated." });
          queryClient.invalidateQueries({ queryKey: getGetNotifierSettingsQueryKey() });
        },
        onError: (error: any) => {
          toast({
            title: "Save failed",
            description: error?.response?.data?.error || error?.message || "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  }

  function onTest() {
    testNotifierMutation.mutate(undefined, {
      onSuccess: (result) => {
        if (result.ok) {
          toast({
            title: "Test sent ✓",
            description: result.text ?? "Webhook delivered successfully.",
          });
          queryClient.invalidateQueries({ queryKey: getGetNotifierSettingsQueryKey() });
        } else {
          toast({
            title: "Test failed",
            description: result.error ?? "Webhook call failed.",
            variant: "destructive",
          });
        }
      },
      onError: (error: any) => {
        toast({
          title: "Test failed",
          description: error?.response?.data?.error || error?.message || "Unknown error",
          variant: "destructive",
        });
      },
    });
  }

  return (
    <Layout title="Settings">
      <div className="space-y-6">
        {/* ── Connection Status ──────────────────────────────────────────── */}
        <Card
          className={cn(
            "border shadow-sm",
            credStatus?.isConfigured
              ? "border-emerald-500/50 bg-emerald-500/5"
              : "border-amber-500/50 bg-amber-500/5",
          )}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isLoadingStatus ? (
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              ) : credStatus?.isConfigured ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              ) : (
                <ShieldAlert className="w-6 h-6 text-amber-500" />
              )}
              <div>
                <h3 className="font-semibold text-sm">Connection Status</h3>
                <p className="text-xs text-muted-foreground">
                  {isLoadingStatus
                    ? "Checking..."
                    : credStatus?.isConfigured
                      ? `Connected to ${credStatus.environment || "production"}`
                      : "Not signed in"}
                </p>
              </div>
            </div>
            {credStatus?.isConfigured && (
              <Badge variant="outline" className="bg-background text-[10px]">
                Active
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* ── eWater Sign In ────────────────────────────────────────────── */}
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
            <Form {...credForm}>
              <form onSubmit={credForm.handleSubmit(onCredSubmit)} className="space-y-4">
                <FormField
                  control={credForm.control}
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
                  control={credForm.control}
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
                  <Button
                    type="submit"
                    disabled={saveMutation.isPending}
                    className="w-full"
                  >
                    {saveMutation.isPending && (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    Sign In
                  </Button>
                  {credStatus?.isConfigured && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onClear}
                      disabled={clearMutation.isPending}
                      className="w-full text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
                    >
                      {clearMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4 mr-2" />
                      )}
                      Sign Out
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* ── Registration Webhook ──────────────────────────────────────── */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Webhook className="w-5 h-5" />
              Registration Webhook
            </CardTitle>
            <CardDescription>
              POST a registration summary to a webhook URL every N minutes.
              The payload includes total registrations, new sign-ups today, and
              litres dispensed per system.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingNotifier ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading settings…
              </div>
            ) : (
              <Form {...notifierForm}>
                <form
                  onSubmit={notifierForm.handleSubmit(onNotifierSubmit)}
                  className="space-y-5"
                >
                  {/* Enable toggle */}
                  <FormField
                    control={notifierForm.control}
                    name="enabled"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-3">
                          <Switch
                            id="notifier-enabled"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                          <Label htmlFor="notifier-enabled" className="cursor-pointer">
                            {field.value ? "Enabled" : "Disabled"}
                          </Label>
                        </div>
                      </FormItem>
                    )}
                  />

                  {/* Webhook URL */}
                  <FormField
                    control={notifierForm.control}
                    name="webhookUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Webhook URL</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="https://hooks.example.com/…"
                            type="url"
                            {...field}
                            className="bg-background font-mono text-xs"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Refresh minutes */}
                  <FormField
                    control={notifierForm.control}
                    name="refreshMinutes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cadence (minutes)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={5}
                            max={1440}
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            className="bg-background w-32"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          5 – 1440 min. Also controls the "in N mins" window in
                          the summary text.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Systems */}
                  <div className="space-y-2">
                    <Label>Water Systems</Label>
                    <p className="text-xs text-muted-foreground">
                      Lines appear in this order in the summary text.
                    </p>
                    <div className="space-y-2">
                      {fields.map((field, index) => (
                        <div key={field.id} className="flex items-center gap-2">
                          <Input
                            type="number"
                            placeholder="ID"
                            {...notifierForm.register(`systems.${index}.id`, {
                              valueAsNumber: true,
                            })}
                            className="bg-background w-24 text-xs"
                          />
                          <Input
                            placeholder="Name"
                            {...notifierForm.register(`systems.${index}.name`)}
                            className="bg-background text-xs"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => remove(index)}
                            disabled={fields.length <= 1}
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ id: 0, name: "" })}
                      className="mt-1"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add system
                    </Button>
                    {notifierForm.formState.errors.systems?.root && (
                      <p className="text-xs text-destructive">
                        {notifierForm.formState.errors.systems.root.message}
                      </p>
                    )}
                  </div>

                  {/* Status line */}
                  {notifierData && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {formatLastRun(
                          notifierData.lastRunAt ?? null,
                          notifierData.lastResult ?? null,
                        )}
                      </span>
                      {notifierData.lastResult === "failed" &&
                        notifierData.lastError && (
                          <span className="text-destructive truncate max-w-[200px]">
                            — {notifierData.lastError}
                          </span>
                        )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="submit"
                      disabled={updateNotifier.isPending}
                      className="flex-1"
                    >
                      {updateNotifier.isPending && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onTest}
                      disabled={testNotifierMutation.isPending || !notifierData?.webhookUrl}
                      title={
                        !notifierData?.webhookUrl
                          ? "Save a webhook URL first"
                          : "Send one test payload now"
                      }
                    >
                      {testNotifierMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 mr-2" />
                      )}
                      Send test
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
