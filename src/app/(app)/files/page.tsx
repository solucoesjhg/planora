import { Files } from "lucide-react";
import { PlannedScreen } from "@/app/(app)/_planned";

export default function FilesPage() {
  return (
    <PlannedScreen
      title="Arquivos"
      icon={Files}
      description="A galeria de todos os anexos, agrupada por projeto, chega na fase 8. Até lá, os arquivos vivem dentro de cada tarefa."
    />
  );
}
