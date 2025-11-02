declare namespace Cloudflare {
	interface Env {
		MERCADO_PAGO_ACCESS_TOKEN: string;
	}
}

interface Env extends Cloudflare.Env {}
