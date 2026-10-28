import express from 'express';
import { supabase } from '../config/supabase';
import { autenticar } from '../middleware/auth';

const router = express.Router();

// POST /api/exames - Recebe JSON estruturado da extensão
router.post('/', autenticar, async (req, res) => {
  const requestId = (req as any).requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const {
      nome_paciente,
      data_exame,
      resultado_json,
      analise_ia,
      plano_terapeutico,
      pontos_criticos,
      indice_biosync,
      status = 'processado'
    } = req.body;

    // Validação básica
    if (!nome_paciente || !data_exame || !resultado_json) {
      return res.status(400).json({
        error: 'Campos obrigatórios: nome_paciente, data_exame, resultado_json',
        requestId
      });
    }

    // Preparar dados para inserção
    const exameData = {
      nome_paciente,
      data_exame,
      resultado_json,
      analise_ia: analise_ia || null,
      plano_terapeutico: plano_terapeutico || [],
      pontos_criticos: pontos_criticos || [],
      indice_biosync: indice_biosync || null,
      status,
      created_at: new Date().toISOString()
    };

    // Inserir no Supabase usando service_role
    const { data, error } = await supabase
      .from('exames')
      .insert([exameData])
      .select()
      .single();

    if (error) {
      console.error(`❌ [${requestId}] Erro ao inserir exame:`, error);
      return res.status(500).json({
        error: 'Falha ao salvar exame no banco de dados',
        details: error.message,
        requestId
      });
    }

    console.log(`✅ [${requestId}] Exame salvo: ${data.id} - ${nome_paciente}`);
    
    return res.status(201).json({
      ok: true,
      exame: data,
      requestId
    });

  } catch (error: any) {
    console.error(`❌ [${requestId}] Erro inesperado:`, error);
    return res.status(500).json({
      error: 'Erro interno do servidor',
      details: error.message,
      requestId
    });
  }
});

// GET /api/exames - Lista exames (protegido)
router.get('/', autenticar, async (req, res) => {
  const requestId = (req as any).requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const { page = 1, limit = 50, paciente } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('exames')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    // Filtro opcional por nome do paciente
    if (paciente && typeof paciente === 'string') {
      query = query.ilike('nome_paciente', `%${paciente}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error(`❌ [${requestId}] Erro ao listar exames:`, error);
      return res.status(500).json({
        error: 'Falha ao listar exames',
        details: error.message,
        requestId
      });
    }

    return res.json({
      ok: true,
      exames: data || [],
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      requestId
    });

  } catch (error: any) {
    console.error(`❌ [${requestId}] Erro inesperado:`, error);
    return res.status(500).json({
      error: 'Erro interno do servidor',
      details: error.message,
      requestId
    });
  }
});

// GET /api/exames/:id - Busca exame específico
router.get('/:id', autenticar, async (req, res) => {
  const requestId = (req as any).requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('exames')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({
        error: 'Exame não encontrado',
        requestId
      });
    }

    return res.json({
      ok: true,
      exame: data,
      requestId
    });

  } catch (error: any) {
    console.error(`❌ [${requestId}] Erro inesperado:`, error);
    return res.status(500).json({
      error: 'Erro interno do servidor',
      details: error.message,
      requestId
    });
  }
});

export default router;