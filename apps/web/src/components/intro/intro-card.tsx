import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@taskaws/ui/components/card";

type IntroCardProps = {
  name: string;
  avatarUrl?: string | null;
  text: string;
  thinking: boolean;
  done: boolean;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  return parts
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function IntroCard({
  name,
  avatarUrl,
  text,
  thinking,
  done,
}: IntroCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="size-10 rounded-full object-cover ring-1 ring-foreground/10"
            />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
              {getInitials(name)}
            </div>
          )}
          <CardTitle className="text-base font-semibold">{name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="min-h-[5rem] whitespace-pre-wrap text-sm leading-relaxed">
          {text ||
            (thinking || done ? "" : "No intro available.")}
        </div>
        {thinking && (
          <div className="mt-3 text-xs text-muted-foreground">
            🤔 Generating…
          </div>
        )}
      </CardContent>
    </Card>
  );
}
