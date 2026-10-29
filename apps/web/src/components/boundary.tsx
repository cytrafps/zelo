import { Component, type ReactNode } from 'react';

/**
 * Une erreur de rendu (carte, donnée inattendue) n'efface plus toute la page : seul ce qui est
 * dessous est remplacé par `fallback`. Changer de `key` (de page) repart de zéro.
 */
export class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
