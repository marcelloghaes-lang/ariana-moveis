import time
import requests


class ArianaEnterpriseError(Exception):
    def __init__(self, message, status_code=None, response=None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response


class _Resource:
    def __init__(self, client):
        self.client = client


class CatalogResource(_Resource):
    def push(self, products, manufacturer="ariana_moveis"):
        return self.client.request("POST", "/enterprise/catalog/push", {
            "manufacturer": manufacturer,
            "products": products
        })


class ProductsResource(_Resource):
    def sync(self, sku, data):
        return self.client.request("POST", f"/enterprise/products/{sku}/sync", data)

    def update_stock(self, sku, stock, manufacturer="ariana_moveis"):
        return self.client.request("PUT", f"/enterprise/products/{sku}/stock", {
            "manufacturer": manufacturer,
            "stock": stock
        })

    def update_price(self, sku, price, manufacturer="ariana_moveis"):
        return self.client.request("PUT", f"/enterprise/products/{sku}/price", {
            "manufacturer": manufacturer,
            "price": price
        })


class OrdersResource(_Resource):
    def create(self, order):
        return self.client.request("POST", "/enterprise/orders", order)


class InvoiceResource(_Resource):
    def send(self, order_id, invoice):
        return self.client.request("POST", f"/enterprise/orders/{order_id}/invoice", invoice)


class TrackingResource(_Resource):
    def update(self, order_id, tracking):
        return self.client.request("POST", f"/enterprise/orders/{order_id}/tracking", tracking)


class WebhooksResource(_Resource):
    def test(self, event="order_ack", message="Webhook de teste enviado pelo SDK Python"):
        return self.client.request("POST", "/enterprise/webhooks/test", {
            "event": event,
            "message": message
        })


class ArianaEnterpriseClient:
    def __init__(self, api_key=None, client_id=None, client_secret=None, environment="sandbox", version="v1", base_url=None, timeout=30, retries=2):
        self.api_key = api_key
        self.client_id = client_id
        self.client_secret = client_secret
        self.environment = environment
        self.version = version
        self.base_url = (base_url or "https://ariana-backend.onrender.com/api").rstrip("/")
        self.timeout = timeout
        self.retries = retries
        self._token = None
        self._token_expires_at = 0

        self.catalog = CatalogResource(self)
        self.products = ProductsResource(self)
        self.orders = OrdersResource(self)
        self.invoice = InvoiceResource(self)
        self.tracking = TrackingResource(self)
        self.webhooks = WebhooksResource(self)

    def health(self):
        return self.request("GET", "/enterprise/health")

    def _versioned_path(self, path):
        path = path if path.startswith("/") else f"/{path}"
        if path.startswith("/enterprise/"):
            return f"/{self.version}{path}"
        return path

    def _headers(self):
        headers = {"Content-Type": "application/json", "User-Agent": "ArianaEnterprisePythonSDK/1.0.0"}
        if self.api_key:
            headers["x-ariana-key"] = self.api_key
        elif self.client_id and self.client_secret:
            headers["Authorization"] = f"Bearer {self._get_token()}"
        return headers

    def _get_token(self):
        if self._token and time.time() < self._token_expires_at:
            return self._token
        resp = requests.post(
            f"{self.base_url}/enterprise/oauth/token",
            json={"grant_type": "client_credentials", "client_id": self.client_id, "client_secret": self.client_secret},
            timeout=self.timeout
        )
        if resp.status_code >= 400:
            raise ArianaEnterpriseError("Falha ao gerar token OAuth", resp.status_code, _safe_json(resp))
        data = resp.json()
        self._token = data.get("access_token")
        self._token_expires_at = time.time() + int(data.get("expires_in", 3600)) - 60
        return self._token

    def request(self, method, path, data=None):
        url = f"{self.base_url}{self._versioned_path(path)}"
        last_error = None
        for attempt in range(self.retries + 1):
            try:
                resp = requests.request(method, url, json=data, headers=self._headers(), timeout=self.timeout)
                if resp.status_code == 429 and attempt < self.retries:
                    time.sleep(int(resp.headers.get("Retry-After", "1")))
                    continue
                if resp.status_code >= 400:
                    raise ArianaEnterpriseError(f"HTTP {resp.status_code}", resp.status_code, _safe_json(resp))
                return _safe_json(resp)
            except requests.RequestException as exc:
                last_error = exc
                if attempt < self.retries:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise ArianaEnterpriseError(str(last_error)) from last_error
        raise ArianaEnterpriseError("Falha desconhecida na requisição")


def _safe_json(resp):
    try:
        return resp.json()
    except Exception:
        return {"raw": resp.text}
