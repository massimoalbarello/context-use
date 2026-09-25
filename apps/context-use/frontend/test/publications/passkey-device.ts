export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function authenticator(cleanups: (() => void)[]) {
  const calls: CredentialRequestOptions[] = [];
  const originalCredential = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  const originalCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const response = {
    id: 'AQ',
    rawId: new Uint8Array([1]).buffer,
    type: 'public-key',
    response: {
      clientDataJSON: new Uint8Array([2]).buffer,
      authenticatorData: new Uint8Array([1]).buffer,
      signature: new Uint8Array([1]).buffer,
    },
    getClientExtensionResults: () => ({}),
  } as unknown as Credential;
  const device = { pending: undefined as Promise<Credential> | undefined, calls, response };
  Object.defineProperty(globalThis, 'PublicKeyCredential', {
    configurable: true,
    value: function PublicKeyCredential() {},
  });
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {
      get: (options: CredentialRequestOptions) => {
        calls.push(options);
        return device.pending ?? Promise.resolve(response);
      },
    },
  });
  cleanups.push(() => {
    if (originalCredential) {
      Object.defineProperty(globalThis, 'PublicKeyCredential', originalCredential);
    } else {
      Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
    }
    if (originalCredentials) {
      Object.defineProperty(navigator, 'credentials', originalCredentials);
    } else {
      Reflect.deleteProperty(navigator, 'credentials');
    }
  });
  return device;
}
