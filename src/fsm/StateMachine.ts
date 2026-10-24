export interface State<TContext> {
  readonly name: string;
  onEnter?(context: TContext): void;
  onUpdate?(context: TContext, delta: number): void;
  onExit?(context: TContext): void;
}

export class StateMachine<TContext, TStateName extends string = string> {
  private context: TContext;
  private states = new Map<TStateName, State<TContext>>();
  private currentState: State<TContext> | null = null;

  constructor(context: TContext) {
    this.context = context;
  }

  public addState(name: TStateName, state: State<TContext>): this {
    this.states.set(name, state);
    return this;
  }

  public setState(name: TStateName): void {
    const nextState = this.states.get(name);
    if (!nextState) {
      console.warn(`[FSM] Estado no encontrado: ${name}`);
      return;
    }

    if (this.currentState === nextState) {
      return;
    }

    if (this.currentState?.onExit) {
      this.currentState.onExit(this.context);
    }

    this.currentState = nextState;

    if (this.currentState.onEnter) {
      this.currentState.onEnter(this.context);
    }
  }

  public update(delta: number): void {
    if (this.currentState?.onUpdate) {
      this.currentState.onUpdate(this.context, delta);
    }
  }

  public getStateName(): TStateName | null {
    return (this.currentState?.name as TStateName) ?? null;
  }

  public isInState(...names: TStateName[]): boolean {
    const current = this.getStateName();
    return current !== null && names.includes(current);
  }
}
