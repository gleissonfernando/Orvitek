/**
 * Utilitários de animação para performance
 * Usa CSS puro em vez de framer-motion para overhead menor
 */

/**
 * Aplica classe de animação a um elemento
 */
export function applyAnimation(element: HTMLElement, animation: "fade-in" | "slide-in" | "fade-in-up") {
  element.classList.add(`animate-${animation}`);
}

/**
 * Remove classe de animação
 */
export function removeAnimation(element: HTMLElement, animation: "fade-in" | "slide-in" | "fade-in-up") {
  element.classList.remove(`animate-${animation}`);
}

/**
 * Tipos de animações disponíveis
 */
export type AnimationType = "fade-in" | "slide-in" | "fade-in-up" | "fade-out" | "slide-out";

/**
 * Configuração de animação
 */
export interface AnimationConfig {
  duration?: "fast" | "normal" | "slow";
  easing?: "ease-in" | "ease-out" | "ease-in-out" | "linear";
  delay?: number;
}

/**
 * Aplica animação customizada com delay
 */
export function animateElement(
  element: HTMLElement,
  animation: AnimationType,
  config: AnimationConfig = {}
) {
  const { duration = "normal", delay = 0 } = config;

  if (delay > 0) {
    setTimeout(() => {
      element.classList.add(`animate-${animation}`, `transition-${duration}`);
    }, delay);
  } else {
    element.classList.add(`animate-${animation}`, `transition-${duration}`);
  }
}

/**
 * Aguarda fim de animação
 */
export async function waitForAnimation(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      element.removeEventListener("animationend", handler);
      resolve();
    };
    element.addEventListener("animationend", handler);
  });
}
