import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Empêche qu'une erreur de rendu (ex: hoquet de MapLibre) ne démonte toute
 * l'application en laissant une page blanche. Affiche à la place un message
 * et un bouton pour recharger.
 */
// Composant de classe : il n'a pas de hook, donc pas d'abonnement à la langue.
// C'est sans conséquence — l'écran ne survit pas à un rechargement, qui est
// précisément ce qu'il propose.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erreur non rattrapée dans l'UI :", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <h1>{t("error.title")}</h1>
        <p>{this.state.error.message}</p>
        <button onClick={() => window.location.reload()}>{t("error.reload")}</button>
      </div>
    );
  }
}
