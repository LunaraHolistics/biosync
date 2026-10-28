import { Request, Response, NextFunction } from 'express';

export function autenticar(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;
  const expectedKey = process.env.APP_SECRET_KEY;

  if (!expectedKey) {
    console.error('❌ APP_SECRET_KEY não configurada no servidor');
    return res.status(500).json({ error: 'Erro de configuração do servidor' });
  }

  if (!apiKey || apiKey !== expectedKey) {
    console.warn(`⚠️ Tentativa de acesso não autorizado de ${req.ip}`);
    return res.status(401).json({ error: 'Não autorizado' });
  }

  next();
}