import { IntroCard } from "@/components/intro/intro-card";
import { useIntroStream } from "@/components/intro/use-intro-stream";
import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
import { Navigate } from "react-router";

import type { Route } from "./+types/intro";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Intro — TaskAWS" }];
}

export default function Intro() {
  const { data: session, isPending } = authClient.useSession();
  const { text, thinking, done } = useIntroStream(session?.user?.id);

  if (isPending) {
    return <Loader />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main className="container mx-auto flex min-h-full flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl">
        <h1 className="mb-4 text-center text-lg font-semibold">Personal Intro</h1>
        <IntroCard
          name={session.user.name}
          avatarUrl={session.user.image ?? null}
          text={text}
          thinking={thinking}
          done={done}
        />
      </div>
    </main>
  );
}
