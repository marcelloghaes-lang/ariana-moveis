# main.py
from wsgiref.simple_server import make_server

def application(environ, start_response):
    status = '200 OK'
    headers = [('Content-type', 'text/plain; charset=utf-8')]
    start_response(status, headers)
    return [b"Ola, App Engine funcionando!"]

if __name__ == '__main__':
    with make_server('', 8080, application) as httpd:
        print("Servindo na porta 8080...")
        httpd.serve_forever()