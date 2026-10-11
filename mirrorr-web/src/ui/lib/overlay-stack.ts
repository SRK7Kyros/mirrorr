const stack: string[] = []

export function pushOverlay(id: string): void {
  stack.push(id)
}

export function popOverlay(id: string): void {
  const index = stack.lastIndexOf(id)
  if (index !== -1) stack.splice(index, 1)
}

export function isTopOverlay(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}