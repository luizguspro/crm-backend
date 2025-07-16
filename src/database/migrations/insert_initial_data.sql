-- Script para inserir dados iniciais no Maya CRM
-- Execute APÓS criar as tabelas

-- Inserir empresa padrão (se não existir)
INSERT INTO empresas (id, nome, cnpj, telefone, email, plano)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Empresa Demo',
    '00.000.000/0001-00',
    '(47) 99999-9999',
    'contato@empresademo.com',
    'premium'
) ON CONFLICT (id) DO NOTHING;

-- Inserir usuário admin padrão (se não existir)
-- Senha padrão: admin123 (você deve mudar isso!)
INSERT INTO usuarios (id, empresa_id, nome, email, senha, tipo, cargo)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Administrador',
    'admin@empresademo.com',
    '$2b$10$X5QxPsZDh9kL.o5e6E5Nwu5vO.KJdKGwQZfVzP.QE5NqHYKvlVDzG', -- senha: admin123
    'admin',
    'Administrador'
) ON CONFLICT (id) DO NOTHING;

-- Deletar etapas existentes para recriar com ordem correta
DELETE FROM pipeline_etapas WHERE empresa_id = '00000000-0000-0000-0000-000000000001';

-- Inserir etapas do pipeline
INSERT INTO pipeline_etapas (empresa_id, nome, descricao, cor, ordem, tipo) VALUES 
    ('00000000-0000-0000-0000-000000000001', 'Novos Leads', 'Leads que acabaram de entrar no funil', '#3B82F6', 1, 'normal'),
    ('00000000-0000-0000-0000-000000000001', 'Qualificados', 'Leads com potencial confirmado', '#8B5CF6', 2, 'normal'),
    ('00000000-0000-0000-0000-000000000001', 'Em Negociação', 'Em processo de negociação ativa', '#F59E0B', 3, 'normal'),
    ('00000000-0000-0000-0000-000000000001', 'Proposta', 'Proposta comercial enviada', '#F97316', 4, 'normal'),
    ('00000000-0000-0000-0000-000000000001', 'Ganhos', 'Negócios fechados com sucesso', '#10B981', 5, 'ganho'),
    ('00000000-0000-0000-0000-000000000001', 'Perdidos', 'Oportunidades que não avançaram', '#EF4444', 6, 'perdido'),
    ('00000000-0000-0000-0000-000000000001', 'Cadência de Contato', 'Leads em processo de follow-up', '#FFA500', 7, 'normal');

-- Inserir canal de integração padrão (WhatsApp)
INSERT INTO canais_integracao (id, empresa_id, tipo, nome, configuracao, status)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'whatsapp',
    'WhatsApp Principal',
    '{"phone": "+5511999999999", "active": true}',
    'ativo'
) ON CONFLICT (id) DO NOTHING;

-- Inserir alguns contatos de exemplo
INSERT INTO contatos (empresa_id, nome, email, whatsapp, score, origem) VALUES 
    ('00000000-0000-0000-0000-000000000001', 'João Silva', 'joao@example.com', '11987654321', 85, 'whatsapp'),
    ('00000000-0000-0000-0000-000000000001', 'Maria Santos', 'maria@example.com', '11876543210', 70, 'website'),
    ('00000000-0000-0000-0000-000000000001', 'Pedro Oliveira', 'pedro@example.com', '11765432109', 60, 'instagram')
ON CONFLICT DO NOTHING;

-- Verificar se tudo foi criado
DO $$
DECLARE
    empresas_count INTEGER;
    usuarios_count INTEGER;
    etapas_count INTEGER;
    contatos_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO empresas_count FROM empresas;
    SELECT COUNT(*) INTO usuarios_count FROM usuarios;
    SELECT COUNT(*) INTO etapas_count FROM pipeline_etapas;
    SELECT COUNT(*) INTO contatos_count FROM contatos;
    
    RAISE NOTICE 'Dados inseridos:';
    RAISE NOTICE '- Empresas: %', empresas_count;
    RAISE NOTICE '- Usuários: %', usuarios_count;
    RAISE NOTICE '- Etapas do Pipeline: %', etapas_count;
    RAISE NOTICE '- Contatos: %', contatos_count;
END $$;