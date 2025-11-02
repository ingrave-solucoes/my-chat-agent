/**
 * Payment Processing Workflow with Mercado Pago Integration
 *
 * This worker handles payment creation, status checking, and webhook processing
 * for Mercado Pago integration with the chat agent.
 */

interface MercadoPagoPreference {
	items: Array<{
		title: string;
		quantity: number;
		unit_price: number;
		currency_id?: string;
	}>;
	payer?: {
		name?: string;
		email?: string;
		phone?: {
			area_code?: string;
			number?: string;
		};
	};
	back_urls?: {
		success?: string;
		failure?: string;
		pending?: string;
	};
	auto_return?: 'approved' | 'all';
	external_reference?: string;
	notification_url?: string;
}

interface MercadoPagoPayment {
	id: number;
	status: string;
	status_detail: string;
	transaction_amount: number;
	currency_id: string;
	description: string;
	external_reference?: string;
	payer: {
		email: string;
		identification?: {
			type: string;
			number: string;
		};
	};
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// CORS headers for all responses
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		};

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			switch (url.pathname) {
				case '/payment/create': {
					// Create a new payment preference
					if (request.method !== 'POST') {
						return new Response('Method not allowed', { status: 405, headers: corsHeaders });
					}

					const body: MercadoPagoPreference = await request.json();

					if (!env.MERCADO_PAGO_ACCESS_TOKEN) {
						return Response.json(
							{ error: 'Mercado Pago not configured' },
							{ status: 500, headers: corsHeaders }
						);
					}

					// Add required back_urls when auto_return is set
					if (body.auto_return && !body.back_urls?.success) {
						body.back_urls = {
							success: 'https://ingrave.com.br/pagamento/sucesso',
							failure: 'https://ingrave.com.br/pagamento/falha',
							pending: 'https://ingrave.com.br/pagamento/pendente',
							...body.back_urls
						};
					}

					// Create preference on Mercado Pago
					const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${env.MERCADO_PAGO_ACCESS_TOKEN}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(body),
					});

					if (!mpResponse.ok) {
						const error = await mpResponse.text();
						return Response.json(
							{ error: 'Failed to create payment', details: error },
							{ status: mpResponse.status, headers: corsHeaders }
						);
					}

					const preference = await mpResponse.json();

					return Response.json({
						success: true,
						preference_id: preference.id,
						init_point: preference.init_point,
						sandbox_init_point: preference.sandbox_init_point,
					}, { headers: corsHeaders });
				}

				case '/payment/status': {
					// Check payment status
					const paymentId = url.searchParams.get('id');

					if (!paymentId) {
						return Response.json(
							{ error: 'Payment ID is required' },
							{ status: 400, headers: corsHeaders }
						);
					}

					if (!env.MERCADO_PAGO_ACCESS_TOKEN) {
						return Response.json(
							{ error: 'Mercado Pago not configured' },
							{ status: 500, headers: corsHeaders }
						);
					}

					const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
						headers: {
							'Authorization': `Bearer ${env.MERCADO_PAGO_ACCESS_TOKEN}`,
						},
					});

					if (!mpResponse.ok) {
						return Response.json(
							{ error: 'Payment not found' },
							{ status: 404, headers: corsHeaders }
						);
					}

					const payment: MercadoPagoPayment = await mpResponse.json();

					return Response.json({
						id: payment.id,
						status: payment.status,
						status_detail: payment.status_detail,
						amount: payment.transaction_amount,
						currency: payment.currency_id,
						description: payment.description,
						external_reference: payment.external_reference,
						payer_email: payment.payer.email,
					}, { headers: corsHeaders });
				}

				case '/payment/webhook': {
					// Handle Mercado Pago webhooks/IPN notifications
					if (request.method !== 'POST') {
						return new Response('Method not allowed', { status: 405, headers: corsHeaders });
					}

					const body = await request.json();
					console.log('[MercadoPago] Webhook received:', JSON.stringify(body, null, 2));

					// Process different notification types
					if (body.type === 'payment') {
						const paymentId = body.data?.id;

						if (paymentId && env.MERCADO_PAGO_ACCESS_TOKEN) {
							// Fetch full payment details
							const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
								headers: {
									'Authorization': `Bearer ${env.MERCADO_PAGO_ACCESS_TOKEN}`,
								},
							});

							if (mpResponse.ok) {
								const payment: MercadoPagoPayment = await mpResponse.json();
								console.log('[MercadoPago] Payment status:', payment.status);

								// Here you can add logic to notify the main agent about payment status
								// For example, call a webhook endpoint on the main worker
								// or store the status in a KV/D1 database
							}
						}
					}

					return Response.json({ success: true }, { headers: corsHeaders });
				}

				case '/health':
					return Response.json({
						status: 'ok',
						service: 'payment-workflow',
						timestamp: new Date().toISOString(),
					}, { headers: corsHeaders });

				default:
					return Response.json(
						{ error: 'Not Found' },
						{ status: 404, headers: corsHeaders }
					);
			}
		} catch (error) {
			console.error('[Payment Workflow] Error:', error);
			return Response.json(
				{
					error: 'Internal server error',
					message: error instanceof Error ? error.message : 'Unknown error'
				},
				{ status: 500, headers: corsHeaders }
			);
		}
	},
} satisfies ExportedHandler<Env>;
