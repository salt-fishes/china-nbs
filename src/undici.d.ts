// Optional peer dependency, only loaded when the CLI --proxy option is used.
declare module 'undici' {
  export class ProxyAgent {
    constructor(url: string);
  }
}
