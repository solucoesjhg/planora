import { Settings } from "lucide-react";
import { PlannedScreen } from "@/app/(app)/_planned";

export default function SettingsPage() {
  return (
    <PlannedScreen
      title="Configurações"
      icon={Settings}
      description="Tema, perfil, exportação do espaço de trabalho e a zona de perigo chegam na fase 8. O tema já pode ser trocado pelo botão na barra lateral."
    />
  );
}
