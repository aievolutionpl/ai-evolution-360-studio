export class ProviderRegistry {
    constructor(providers) {
        this.providers = new Map();
        for (const provider of providers) {
            if (typeof provider.id !== 'string' || !/^[a-z0-9-]+$/.test(provider.id) || typeof provider.name !== 'string' || !provider.name.trim() || typeof provider.cloud !== 'boolean' || this.providers.has(provider.id) || typeof provider.run !== 'function' || typeof provider.configured !== 'function') throw new Error('Nieprawidłowy provider lub duplikat.');
            this.providers.set(provider.id, provider);
        }
    }
    list() { return [...this.providers.values()].map(p => ({ id: p.id, name: p.name, cloud: p.cloud, configured: Boolean(p.configured()) })); }
    async run(id, context) {
        const provider = this.providers.get(id);
        if (!provider) throw new Error('Nieobsługiwany provider analizy.');
        if (!provider.configured()) throw new Error(provider.configurationError ?? `Provider ${provider.name} nie jest skonfigurowany.`);
        context.signal?.throwIfAborted();
        return provider.run({ ...context, provider: id });
    }
}
