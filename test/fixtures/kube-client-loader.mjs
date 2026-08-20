const mockUrl = new URL('./kube-client-probe.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
	if (specifier === '@kubernetes/client-node') {
		return { url: mockUrl, shortCircuit: true };
	}
	return nextResolve(specifier, context);
}
