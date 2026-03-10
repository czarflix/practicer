export const MOTION_EASE = [0.22, 1, 0.36, 1]
export const MOTION_EASE_SOFT = [0.2, 0.8, 0.2, 1]

export const FAST_TRANSITION = {
  duration: 0.14,
  ease: MOTION_EASE_SOFT,
}

export const STANDARD_TRANSITION = {
  duration: 0.22,
  ease: MOTION_EASE,
}

export const REVEAL_TRANSITION = {
  duration: 0.28,
  ease: MOTION_EASE,
}

export const SPRING_TRANSITION = {
  type: 'spring',
  stiffness: 360,
  damping: 34,
  mass: 0.9,
}

export const pageReveal = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: REVEAL_TRANSITION,
  },
}

export const sectionReveal = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: REVEAL_TRANSITION,
  },
}

export const staggerContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
}

export const panelSwap = {
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: 1,
    y: 0,
    transition: STANDARD_TRANSITION,
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: FAST_TRANSITION,
  },
}

export const overlayPop = {
  initial: { opacity: 0, x: -6, y: 4, scale: 0.985 },
  animate: {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    transition: STANDARD_TRANSITION,
  },
  exit: {
    opacity: 0,
    x: -4,
    y: 2,
    scale: 0.985,
    transition: FAST_TRANSITION,
  },
}

export const cardHover = {
  whileHover: { y: -1 },
  transition: FAST_TRANSITION,
}

export const buttonTap = {
  whileTap: { scale: 0.985 },
  transition: FAST_TRANSITION,
}

export const outputSwap = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: STANDARD_TRANSITION,
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: FAST_TRANSITION,
  },
}
