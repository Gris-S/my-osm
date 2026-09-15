import { LocateFixed } from "lucide-react";
import { useI18n } from "../i18n";

interface LocateButtonProps {
  onClick: () => void;
  loading: boolean;
  offsetBottom: number;
}

export function LocateButton({ onClick, loading, offsetBottom }: LocateButtonProps) {
  const { t } = useI18n();

  return (
    <button
      className={`locate-button ${loading ? "is-loading" : ""}`}
      style={{ bottom: offsetBottom }}
      onClick={onClick}
      aria-label={t("locate.aria")}
    >
      <LocateFixed size={20} />
    </button>
  );
}
