export interface LatestRequestToken {
  id: number;
  controller: AbortController;
}

export class LatestRequestGate {
  private sequence = 0;
  private active: LatestRequestToken | null = null;

  begin(): LatestRequestToken {
    this.active?.controller.abort();
    const token = {
      id: ++this.sequence,
      controller: new AbortController(),
    };
    this.active = token;
    return token;
  }

  isCurrent(token: LatestRequestToken) {
    return this.active === token && !token.controller.signal.aborted;
  }

  finish(token: LatestRequestToken) {
    if (this.active === token) this.active = null;
  }

  cancel() {
    this.active?.controller.abort();
    this.active = null;
    this.sequence += 1;
  }
}
