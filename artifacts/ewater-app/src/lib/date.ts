import { format, formatDistanceToNow } from "date-fns";

export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "Unknown";
  try {
    return format(new Date(dateString), "MMM d, yyyy HH:mm:ss");
  } catch (e) {
    return "Invalid date";
  }
}

export function formatTimeAgo(dateString: string | null | undefined): string {
  if (!dateString) return "Unknown";
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  } catch (e) {
    return "Invalid date";
  }
}
