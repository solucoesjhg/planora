import { Sparkles } from "lucide-react";
import { PlannedScreen } from "@/app/(app)/_planned";

export default function AssistantPage() {
  return (
    <PlannedScreen
      title="Assistente"
      icon={Sparkles}
      description="O assistente lê o quadro e propõe — nunca escreve sem confirmação. Chega na fase 12, depois do MVP."
    />
  );
}
