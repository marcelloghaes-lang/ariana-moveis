<?php
namespace ArianaEnterprise\Exceptions;

class ArianaEnterpriseException extends \Exception
{
    private int $statusCode;
    private mixed $response;

    public function __construct(string $message, int $statusCode = 0, mixed $response = null)
    {
        parent::__construct($message, $statusCode);
        $this->statusCode = $statusCode;
        $this->response = $response;
    }

    public function getStatusCode(): int { return $this->statusCode; }
    public function getResponse(): mixed { return $this->response; }
}
