<?php
namespace ArianaEnterprise;

use ArianaEnterprise\Exceptions\ArianaEnterpriseException;

class Client
{
    private string $baseUrl;
    private ?string $apiKey;
    private ?string $clientId;
    private ?string $clientSecret;
    private ?string $accessToken = null;
    private int $timeout;
    private int $retries;

    public function __construct(array $config = [])
    {
        $environment = $config['environment'] ?? 'sandbox';
        $this->baseUrl = rtrim($config['baseUrl'] ?? 'https://ariana-backend.onrender.com/api/v1/enterprise', '/');
        $this->apiKey = $config['apiKey'] ?? null;
        $this->clientId = $config['clientId'] ?? null;
        $this->clientSecret = $config['clientSecret'] ?? null;
        $this->timeout = (int)($config['timeout'] ?? 30);
        $this->retries = (int)($config['retries'] ?? 2);
        if ($environment === 'production' && empty($config['baseUrl'])) {
            $this->baseUrl = 'https://ariana-backend.onrender.com/api/v1/enterprise';
        }
    }

    public function health(): array { return $this->request('GET', '/health'); }
    public function authCheck(): array { return $this->request('GET', '/auth/check'); }
    public function catalog(): Catalog { return new Catalog($this); }
    public function products(): Products { return new Products($this); }
    public function orders(): Orders { return new Orders($this); }
    public function invoice(): Invoice { return new Invoice($this); }
    public function tracking(): Tracking { return new Tracking($this); }
    public function webhooks(): Webhooks { return new Webhooks($this); }

    public function authenticate(): string
    {
        if (!$this->clientId || !$this->clientSecret) {
            throw new ArianaEnterpriseException('clientId e clientSecret são obrigatórios para OAuth.');
        }
        $response = $this->rawRequest('POST', '/oauth/token', [
            'grant_type' => 'client_credentials',
            'client_id' => $this->clientId,
            'client_secret' => $this->clientSecret
        ], false);
        $this->accessToken = $response['access_token'] ?? null;
        if (!$this->accessToken) throw new ArianaEnterpriseException('Token OAuth não retornado.', 0, $response);
        return $this->accessToken;
    }

    public function request(string $method, string $path, array $payload = null): array
    {
        $attempt = 0;
        beginning:
        try {
            return $this->rawRequest($method, $path, $payload, true);
        } catch (ArianaEnterpriseException $e) {
            if (in_array($e->getStatusCode(), [429, 500, 502, 503, 504], true) && $attempt < $this->retries) {
                $attempt++;
                usleep(250000 * $attempt);
                goto beginning;
            }
            throw $e;
        }
    }

    private function rawRequest(string $method, string $path, ?array $payload, bool $auth): array
    {
        $url = $this->baseUrl . '/' . ltrim($path, '/');
        $headers = ['Content-Type: application/json', 'Accept: application/json'];
        if ($auth) {
            if ($this->accessToken) $headers[] = 'Authorization: Bearer ' . $this->accessToken;
            elseif ($this->apiKey) $headers[] = 'x-ariana-key: ' . $this->apiKey;
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => $this->timeout,
        ]);
        if ($payload !== null && strtoupper($method) !== 'GET') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
        }
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false || $error) throw new ArianaEnterpriseException('Erro HTTP: ' . $error, $status);
        $json = json_decode($body, true);
        if (!is_array($json)) $json = ['raw' => $body];
        if ($status >= 400) {
            throw new ArianaEnterpriseException($json['error'] ?? $json['message'] ?? 'Erro na Ariana Enterprise API', $status, $json);
        }
        return $json;
    }
}
