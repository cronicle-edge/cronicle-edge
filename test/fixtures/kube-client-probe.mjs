export class CoreV1Api {
	async createNamespacedPod({ body }) {
		process.stdout.write(
			'KUBE_ENV_PROBE=' + JSON.stringify(body.spec.containers[0].env) + '\n'
		);
		return {};
	}
	async readNamespacedPod() { return { spec: {} }; }
}

export class AppsV1Api {}
export class BatchV1Api {}

export class KubeConfig {
	loadFromString() { throw new Error('probe invalid config'); }
	loadFromDefault() {}
	makeApiClient(ApiClass) { return new ApiClass(); }
	getCurrentCluster() { return { name: 'probe-cluster' }; }
}

export class Watch {
	async watch() { return { abort: function() {} }; }
}

export class Log {
	async log() { return { abort: function() {} }; }
}
