import { exec } from 'child_process';

export class LMStudio {
  static runCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, { shell: 'pwsh.exe' }, (error, stdout, stderr) => {
        if (error) {
          reject(stderr || error.message);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  static async status(): Promise<string> {
    return this.runCommand('lms status');
  }

  static async startServer(): Promise<string> {
    return this.runCommand('lms server start');
  }

  static async stopServer(): Promise<string> {
    return this.runCommand('lms server stop');
  }

  static async listModels(): Promise<string> {
    return this.runCommand('lms ls');
  }

  static async listLoadedModels(): Promise<string> {
    return this.runCommand('lms ps');
  }

  static async loadModel(model: string, options: string = ''): Promise<string> {
    return this.runCommand(`lms load ${model} ${options}`.trim());
  }

  static async unloadModel(options: string = ''): Promise<string> {
    return this.runCommand(`lms unload ${options}`.trim());
  }
}
