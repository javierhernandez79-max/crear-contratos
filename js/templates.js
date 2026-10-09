// Biblioteca de plantillas y cláusulas.
// Las variables se escriben como {{clave}} dentro del texto y se definen en `vars`:
// [clave, etiqueta, tipo, valorPorDefecto?]  — tipos: text | date | money | number | address | email

export const CATEGORIES = [
  { id: 'confidencialidad', label: 'Confidencialidad' },
  { id: 'servicios', label: 'Servicios y consultoría' },
  { id: 'laboral', label: 'Laboral y contratación' },
  { id: 'asociacion', label: 'Asociación' },
  { id: 'pi', label: 'Propiedad intelectual' },
  { id: 'comercial', label: 'Comercial' },
];

const COMMON = [
  ['ciudad_firma', 'Ciudad de firma', 'text', 'Ciudad de México'],
  ['fecha_firma', 'Fecha de firma', 'date'],
  ['jurisdiccion', 'Jurisdicción (tribunales)', 'text', 'la Ciudad de México'],
];

const s = (title, body) => ({ title, body: body.trim().replace(/^ +/gm, '') });

export const TEMPLATES = [
  {
    id: 'nda-mutuo',
    category: 'confidencialidad',
    name: 'Acuerdo de confidencialidad mutuo (NDA)',
    description: 'Ambas partes comparten información confidencial y se obligan a protegerla.',
    vars: [
      ['parte_a', 'Nombre de la Parte A', 'text'],
      ['domicilio_a', 'Domicilio de la Parte A', 'address'],
      ['parte_b', 'Nombre de la Parte B', 'text'],
      ['domicilio_b', 'Domicilio de la Parte B', 'address'],
      ['proposito', 'Propósito de la relación', 'text', 'evaluar una posible relación de negocios'],
      ['vigencia_anios', 'Vigencia (años)', 'number', '3'],
      ...COMMON,
    ],
    signers: [
      { role: 'Parte A', name: '{{parte_a}}', bind: { prefix: 'a', nombre: 'parte_a', domicilio: 'domicilio_a' } },
      { role: 'Parte B', name: '{{parte_b}}', bind: { prefix: 'b', nombre: 'parte_b', domicilio: 'domicilio_b' } },
    ],
    sections: [
      s('Partes', `
        El presente Acuerdo de Confidencialidad (el "Acuerdo") se celebra en {{ciudad_firma}} el {{fecha_firma}} entre {{parte_a}}, con domicilio en {{domicilio_a}} (la "Parte A"), y {{parte_b}}, con domicilio en {{domicilio_b}} (la "Parte B"), en conjunto "las Partes".`),
      s('Propósito', `
        Las Partes desean intercambiar información con el fin de {{proposito}} (el "Propósito"). Este Acuerdo regula el uso y la protección de dicha información.`),
      s('Información confidencial', `
        Se considera Información Confidencial toda información técnica, comercial, financiera, operativa o de cualquier otra naturaleza que una Parte (la "Parte Reveladora") entregue a la otra (la "Parte Receptora"), ya sea por escrito, de forma verbal, electrónica o por cualquier otro medio, incluyendo sin limitar: planes de negocio, listas de clientes, precios, software, procesos, diseños y know-how.`),
      s('Exclusiones', `
        No será Información Confidencial aquella que: (a) sea o llegue a ser de dominio público sin culpa de la Parte Receptora; (b) estuviera en posesión legítima de la Parte Receptora antes de su divulgación; (c) sea desarrollada de manera independiente por la Parte Receptora; o (d) deba revelarse por mandato de ley o de autoridad competente, en cuyo caso la Parte Receptora notificará previamente a la Parte Reveladora en la medida en que la ley lo permita.`),
      s('Obligaciones', `
        La Parte Receptora se obliga a: (a) usar la Información Confidencial únicamente para el Propósito; (b) no divulgarla a terceros sin consentimiento previo y por escrito; (c) limitar el acceso a empleados o asesores que necesiten conocerla y que estén sujetos a obligaciones de confidencialidad equivalentes; y (d) protegerla con al menos el mismo grado de cuidado que aplica a su propia información confidencial, y nunca con menos que un cuidado razonable.`),
      s('Vigencia', `
        Este Acuerdo estará vigente por {{vigencia_anios}} años contados a partir de la fecha de firma. Las obligaciones de confidencialidad subsistirán por el mismo plazo después de su terminación.`),
      s('Devolución de información', `
        A solicitud de la Parte Reveladora, o al término de este Acuerdo, la Parte Receptora devolverá o destruirá la Información Confidencial y sus copias, y confirmará por escrito dicha devolución o destrucción.`),
      s('Ley aplicable y jurisdicción', `
        Este Acuerdo se rige por las leyes aplicables. Para su interpretación y cumplimiento, las Partes se someten a los tribunales competentes de {{jurisdiccion}}, renunciando a cualquier otro fuero que pudiera corresponderles.`),
    ],
  },
  {
    id: 'nda-unilateral',
    category: 'confidencialidad',
    name: 'Acuerdo de confidencialidad unilateral',
    description: 'Solo una parte revela información; la otra se obliga a resguardarla.',
    vars: [
      ['reveladora', 'Parte Reveladora', 'text'],
      ['receptora', 'Parte Receptora', 'text'],
      ['proposito', 'Propósito', 'text', 'evaluar la contratación de servicios'],
      ['vigencia_anios', 'Vigencia (años)', 'number', '2'],
      ['pena_convencional', 'Pena convencional', 'money', '100000'],
      ...COMMON,
    ],
    signers: [
      { role: 'Parte Reveladora', name: '{{reveladora}}', bind: { prefix: 'reveladora', nombre: 'reveladora' } },
      { role: 'Parte Receptora', name: '{{receptora}}', bind: { prefix: 'receptora', nombre: 'receptora' } },
    ],
    sections: [
      s('Partes', `
        Acuerdo celebrado en {{ciudad_firma}} el {{fecha_firma}} entre {{reveladora}} (la "Parte Reveladora") y {{receptora}} (la "Parte Receptora").`),
      s('Objeto', `
        La Parte Reveladora compartirá Información Confidencial con la Parte Receptora con el único fin de {{proposito}}. La Parte Receptora se obliga a mantenerla en estricta confidencialidad.`),
      s('Obligaciones de la Parte Receptora', `
        La Parte Receptora no podrá copiar, divulgar, publicar ni utilizar la Información Confidencial para fines distintos al objeto de este Acuerdo, y responderá por el incumplimiento de sus empleados, asesores o subcontratistas.`),
      s('Pena convencional', `
        En caso de incumplimiento, la Parte Receptora pagará a la Parte Reveladora una pena convencional de {{pena_convencional}}, sin perjuicio de los daños y perjuicios adicionales que se acrediten.`),
      s('Vigencia', `
        Las obligaciones de este Acuerdo estarán vigentes durante {{vigencia_anios}} años a partir de su firma.`),
      s('Jurisdicción', `
        Para todo lo relativo a este Acuerdo, las partes se someten a los tribunales competentes de {{jurisdiccion}}.`),
    ],
  },
  {
    id: 'servicios',
    category: 'servicios',
    name: 'Contrato de prestación de servicios',
    description: 'Para servicios profesionales con alcance, honorarios y forma de pago definidos.',
    vars: [
      ['cliente', 'Cliente', 'text'],
      ['domicilio_cliente', 'Domicilio del cliente', 'address'],
      ['prestador', 'Prestador de servicios', 'text'],
      ['domicilio_prestador', 'Domicilio del prestador', 'address'],
      ['descripcion_servicios', 'Descripción de los servicios', 'text'],
      ['honorarios', 'Honorarios totales', 'money'],
      ['forma_pago', 'Forma de pago', 'text', '50% al inicio y 50% a la entrega'],
      ['fecha_inicio', 'Fecha de inicio', 'date'],
      ['fecha_entrega', 'Fecha de entrega', 'date'],
      ['email_cliente', 'Correo del cliente', 'email'],
      ['email_prestador', 'Correo del prestador', 'email'],
      ...COMMON,
    ],
    signers: [
      { role: 'El Cliente', name: '{{cliente}}', bind: { prefix: 'cliente', nombre: 'cliente', domicilio: 'domicilio_cliente', correo: 'email_cliente' } },
      { role: 'El Prestador', name: '{{prestador}}', bind: { prefix: 'prestador', nombre: 'prestador', domicilio: 'domicilio_prestador', correo: 'email_prestador' } },
    ],
    sections: [
      s('Partes', `
        Contrato de prestación de servicios que celebran en {{ciudad_firma}}, el {{fecha_firma}}, por una parte {{cliente}}, con domicilio en {{domicilio_cliente}} ("el Cliente"), y por la otra {{prestador}}, con domicilio en {{domicilio_prestador}} ("el Prestador").`),
      s('Objeto', `
        El Prestador se obliga a prestar al Cliente los siguientes servicios: {{descripcion_servicios}} (los "Servicios"), conforme a los términos de este contrato.`),
      s('Plazo', `
        Los Servicios iniciarán el {{fecha_inicio}} y deberán concluirse a más tardar el {{fecha_entrega}}, salvo que las partes acuerden por escrito una fecha distinta.`),
      s('Honorarios y forma de pago', `
        Como contraprestación, el Cliente pagará al Prestador la cantidad de {{honorarios}} más los impuestos aplicables, de la siguiente forma: {{forma_pago}}. El Prestador emitirá el comprobante fiscal correspondiente por cada pago.`),
      s('Obligaciones del Prestador', `
        El Prestador se obliga a: (a) prestar los Servicios con calidad profesional y diligencia; (b) informar al Cliente sobre el avance cuando éste lo solicite; y (c) cumplir con las leyes aplicables a su actividad.`),
      s('Obligaciones del Cliente', `
        El Cliente se obliga a: (a) proporcionar oportunamente la información y accesos necesarios; (b) revisar y aprobar los entregables en un plazo razonable; y (c) pagar los honorarios en los términos acordados.`),
      s('Relación entre las partes', `
        El Prestador actúa como profesional independiente. Nada en este contrato crea una relación laboral, de sociedad o de agencia entre las partes. El Prestador es el único responsable de sus obligaciones fiscales y de seguridad social.`),
      s('Terminación', `
        Cualquiera de las partes podrá dar por terminado este contrato mediante aviso por escrito con 15 días naturales de anticipación. El Cliente pagará los Servicios efectivamente prestados hasta la fecha de terminación.`),
      s('Notificaciones', `
        Las notificaciones se enviarán a los correos {{email_cliente}} (Cliente) y {{email_prestador}} (Prestador), o a los domicilios señalados en este contrato.`),
      s('Jurisdicción', `
        Para la interpretación y cumplimiento de este contrato, las partes se someten a los tribunales competentes de {{jurisdiccion}}.`),
    ],
  },
  {
    id: 'consultoria',
    category: 'servicios',
    name: 'Contrato de consultoría',
    description: 'Asesoría especializada por horas o por proyecto, con entregables y confidencialidad.',
    vars: [
      ['cliente', 'Cliente', 'text'],
      ['consultor', 'Consultor', 'text'],
      ['area_consultoria', 'Área de consultoría', 'text', 'estrategia comercial'],
      ['entregables', 'Entregables', 'text', 'un diagnóstico y un plan de acción'],
      ['tarifa_hora', 'Tarifa por hora', 'money'],
      ['horas_maximas', 'Horas máximas al mes', 'number', '40'],
      ['duracion_meses', 'Duración (meses)', 'number', '6'],
      ...COMMON,
    ],
    signers: [
      { role: 'El Cliente', name: '{{cliente}}', bind: { prefix: 'cliente', nombre: 'cliente' } },
      { role: 'El Consultor', name: '{{consultor}}', bind: { prefix: 'consultor', nombre: 'consultor' } },
    ],
    sections: [
      s('Partes', `
        Contrato de consultoría celebrado en {{ciudad_firma}} el {{fecha_firma}} entre {{cliente}} ("el Cliente") y {{consultor}} ("el Consultor").`),
      s('Servicios de consultoría', `
        El Consultor brindará asesoría en materia de {{area_consultoria}} y entregará {{entregables}}.`),
      s('Honorarios', `
        El Cliente pagará al Consultor {{tarifa_hora}} por hora efectivamente trabajada, hasta un máximo de {{horas_maximas}} horas al mes, salvo autorización previa por escrito. El Consultor enviará un reporte mensual de horas junto con su factura, pagadera dentro de los 15 días naturales siguientes.`),
      s('Duración', `
        Este contrato tendrá una duración de {{duracion_meses}} meses a partir de su firma y podrá renovarse por acuerdo escrito de las partes.`),
      s('Confidencialidad', `
        El Consultor mantendrá en confidencialidad toda la información del Cliente a la que tenga acceso, durante la vigencia del contrato y por dos años posteriores a su terminación.`),
      s('Propiedad de los entregables', `
        Una vez pagados, los entregables elaborados específicamente para el Cliente serán propiedad de éste. El Consultor conserva la titularidad de sus metodologías, herramientas y conocimientos previos.`),
      s('Jurisdicción', `
        Las partes se someten a los tribunales competentes de {{jurisdiccion}}.`),
    ],
  },
  {
    id: 'laboral',
    category: 'laboral',
    name: 'Contrato individual de trabajo',
    description: 'Términos de contratación: puesto, salario, jornada y prestaciones.',
    vars: [
      ['empresa', 'Empresa (patrón)', 'text'],
      ['representante', 'Representante legal', 'text'],
      ['trabajador', 'Nombre del trabajador', 'text'],
      ['domicilio_trabajador', 'Domicilio del trabajador', 'address'],
      ['puesto', 'Puesto', 'text'],
      ['salario_mensual', 'Salario mensual', 'money'],
      ['jornada', 'Jornada', 'text', 'lunes a viernes de 9:00 a 18:00 horas, con una hora para tomar alimentos'],
      ['lugar_trabajo', 'Lugar de trabajo', 'address'],
      ['fecha_inicio', 'Fecha de inicio', 'date'],
      ['tipo_contrato', 'Duración de la relación', 'text', 'tiempo indeterminado'],
      ...COMMON,
    ],
    signers: [
      { role: 'El Patrón', name: '{{empresa}}, representada por {{representante}}', bind: { prefix: 'patron', nombre: 'empresa', representante: 'representante' } },
      { role: 'El Trabajador', name: '{{trabajador}}', bind: { prefix: 'trabajador', nombre: 'trabajador', domicilio: 'domicilio_trabajador' } },
    ],
    sections: [
      s('Partes', `
        Contrato individual de trabajo que celebran en {{ciudad_firma}}, el {{fecha_firma}}, {{empresa}}, representada por {{representante}} ("el Patrón"), y {{trabajador}}, con domicilio en {{domicilio_trabajador}} ("el Trabajador").`),
      s('Puesto y funciones', `
        El Trabajador prestará sus servicios en el puesto de {{puesto}}, realizando las funciones inherentes al mismo y las demás que le sean asignadas y resulten compatibles con su capacidad.`),
      s('Duración', `
        La relación de trabajo será por {{tipo_contrato}} y comenzará el {{fecha_inicio}}.`),
      s('Lugar y jornada', `
        Los servicios se prestarán en {{lugar_trabajo}}, en una jornada de {{jornada}}.`),
      s('Salario', `
        El Trabajador percibirá un salario mensual de {{salario_mensual}}, pagadero de forma quincenal, del cual el Patrón realizará las retenciones previstas por la ley.`),
      s('Prestaciones', `
        El Trabajador gozará, al menos, de las prestaciones previstas por la legislación laboral aplicable, incluyendo vacaciones, prima vacacional, aguinaldo, días de descanso y seguridad social.`),
      s('Confidencialidad', `
        El Trabajador se obliga a guardar reserva sobre la información confidencial del Patrón a la que tenga acceso con motivo de su trabajo, aun después de terminada la relación laboral.`),
      s('Disposiciones generales', `
        Lo no previsto en este contrato se regirá por la legislación laboral aplicable y el reglamento interior de trabajo del Patrón. Para cualquier controversia, las partes se someten a las autoridades laborales competentes de {{jurisdiccion}}.`),
    ],
  },
  {
    id: 'socios',
    category: 'asociacion',
    name: 'Acuerdo de asociación entre socios',
    description: 'Aportaciones, participación, toma de decisiones y salida de socios.',
    vars: [
      ['socio_1', 'Socio 1', 'text'],
      ['socio_2', 'Socio 2', 'text'],
      ['nombre_proyecto', 'Nombre del proyecto o negocio', 'text'],
      ['objeto_negocio', 'Objeto del negocio', 'text'],
      ['aportacion_1', 'Aportación del Socio 1', 'money'],
      ['aportacion_2', 'Aportación del Socio 2', 'money'],
      ['participacion_1', 'Participación del Socio 1 (%)', 'number', '50'],
      ['participacion_2', 'Participación del Socio 2 (%)', 'number', '50'],
      ...COMMON,
    ],
    signers: [
      { role: 'Socio', name: '{{socio_1}}', bind: { prefix: 'socio_1', nombre: 'socio_1' } },
      { role: 'Socio', name: '{{socio_2}}', bind: { prefix: 'socio_2', nombre: 'socio_2' } },
    ],
    sections: [
      s('Partes', `
        Acuerdo de asociación celebrado en {{ciudad_firma}} el {{fecha_firma}} entre {{socio_1}} y {{socio_2}} (conjuntamente "los Socios") respecto del proyecto denominado {{nombre_proyecto}} (el "Negocio").`),
      s('Objeto', `
        Los Socios acuerdan unir esfuerzos y recursos para {{objeto_negocio}}.`),
      s('Aportaciones', `
        {{socio_1}} aportará {{aportacion_1}} y {{socio_2}} aportará {{aportacion_2}}. Las aportaciones adicionales requerirán el acuerdo unánime de los Socios.`),
      s('Participación y utilidades', `
        La participación de los Socios en el Negocio será de {{participacion_1}}% para {{socio_1}} y {{participacion_2}}% para {{socio_2}}. Las utilidades y pérdidas se distribuirán en la misma proporción.`),
      s('Toma de decisiones', `
        Las decisiones ordinarias se tomarán por mayoría de participación. Requerirán unanimidad: la venta de activos relevantes, la admisión de nuevos socios, la contratación de deuda superior a lo presupuestado y la modificación de este acuerdo.`),
      s('Salida de un socio', `
        El Socio que desee retirarse deberá ofrecer primero su participación a los demás Socios, quienes tendrán un derecho de preferencia de 30 días naturales para adquirirla al valor que determinen de común acuerdo o, en su defecto, un valuador independiente.`),
      s('No competencia', `
        Durante la vigencia de este acuerdo, ningún Socio podrá participar en un negocio que compita directamente con el Negocio sin el consentimiento por escrito de los demás.`),
      s('Solución de controversias', `
        Los Socios procurarán resolver sus diferencias de buena fe. De no lograrlo, se someterán a los tribunales competentes de {{jurisdiccion}}.`),
    ],
  },
  {
    id: 'cesion-pi',
    category: 'pi',
    name: 'Cesión de derechos de propiedad intelectual',
    description: 'Transfiere los derechos patrimoniales de una obra o desarrollo.',
    vars: [
      ['cedente', 'Cedente (autor)', 'text'],
      ['cesionario', 'Cesionario', 'text'],
      ['descripcion_obra', 'Descripción de la obra', 'text'],
      ['contraprestacion', 'Contraprestación', 'money'],
      ['territorio', 'Territorio', 'text', 'todo el mundo'],
      ...COMMON,
    ],
    signers: [
      { role: 'El Cedente', name: '{{cedente}}', bind: { prefix: 'cedente', nombre: 'cedente' } },
      { role: 'El Cesionario', name: '{{cesionario}}', bind: { prefix: 'cesionario', nombre: 'cesionario' } },
    ],
    sections: [
      s('Partes', `
        Contrato de cesión de derechos celebrado en {{ciudad_firma}} el {{fecha_firma}} entre {{cedente}} ("el Cedente") y {{cesionario}} ("el Cesionario").`),
      s('Obra', `
        El Cedente declara ser el autor y titular de los derechos patrimoniales sobre la siguiente obra: {{descripcion_obra}} (la "Obra"), y que ésta es original y no infringe derechos de terceros.`),
      s('Cesión', `
        El Cedente cede al Cesionario, de forma exclusiva, los derechos patrimoniales sobre la Obra, incluyendo su reproducción, distribución, comunicación pública, transformación y explotación por cualquier medio, en {{territorio}}, por el plazo máximo que permita la ley aplicable.`),
      s('Derechos morales', `
        El Cedente conserva los derechos morales que la ley le reconoce como autor de la Obra.`),
      s('Contraprestación', `
        El Cesionario pagará al Cedente la cantidad de {{contraprestacion}} como contraprestación única por la cesión, dentro de los 10 días hábiles siguientes a la firma.`),
      s('Jurisdicción', `
        Las partes se someten a los tribunales competentes de {{jurisdiccion}}.`),
    ],
  },
  {
    id: 'licencia',
    category: 'pi',
    name: 'Licencia de uso',
    description: 'Autoriza el uso de software, marca o contenido sin transferir la propiedad.',
    vars: [
      ['licenciante', 'Licenciante', 'text'],
      ['licenciatario', 'Licenciatario', 'text'],
      ['objeto_licencia', 'Objeto licenciado', 'text'],
      ['regalia', 'Regalía o pago', 'money'],
      ['periodicidad', 'Periodicidad del pago', 'text', 'mensual'],
      ['vigencia_anios', 'Vigencia (años)', 'number', '1'],
      ...COMMON,
    ],
    signers: [
      { role: 'El Licenciante', name: '{{licenciante}}', bind: { prefix: 'licenciante', nombre: 'licenciante' } },
      { role: 'El Licenciatario', name: '{{licenciatario}}', bind: { prefix: 'licenciatario', nombre: 'licenciatario' } },
    ],
    sections: [
      s('Partes', `
        Contrato de licencia de uso celebrado en {{ciudad_firma}} el {{fecha_firma}} entre {{licenciante}} ("el Licenciante") y {{licenciatario}} ("el Licenciatario").`),
      s('Objeto', `
        El Licenciante otorga al Licenciatario una licencia no exclusiva e intransferible para usar {{objeto_licencia}} (el "Material Licenciado") conforme a este contrato.`),
      s('Restricciones', `
        El Licenciatario no podrá sublicenciar, vender, modificar, descompilar ni distribuir el Material Licenciado, salvo autorización previa y por escrito del Licenciante.`),
      s('Pago', `
        El Licenciatario pagará {{regalia}} de forma {{periodicidad}} por el uso del Material Licenciado.`),
      s('Vigencia', `
        La licencia tendrá una vigencia de {{vigencia_anios}} año(s) y se renovará automáticamente por periodos iguales salvo aviso en contrario con 30 días de anticipación.`),
      s('Propiedad', `
        El Licenciante conserva en todo momento la titularidad del Material Licenciado. Esta licencia no implica cesión de derechos.`),
      s('Jurisdicción', `
        Las partes se someten a los tribunales competentes de {{jurisdiccion}}.`),
    ],
  },
  {
    id: 'compraventa',
    category: 'comercial',
    name: 'Contrato de compraventa',
    description: 'Compraventa de un bien mueble con precio y condiciones de entrega.',
    vars: [
      ['vendedor', 'Vendedor', 'text'],
      ['comprador', 'Comprador', 'text'],
      ['descripcion_bien', 'Descripción del bien', 'text'],
      ['precio', 'Precio', 'money'],
      ['fecha_entrega', 'Fecha de entrega', 'date'],
      ['lugar_entrega', 'Lugar de entrega', 'address'],
      ...COMMON,
    ],
    signers: [
      { role: 'El Vendedor', name: '{{vendedor}}', bind: { prefix: 'vendedor', nombre: 'vendedor' } },
      { role: 'El Comprador', name: '{{comprador}}', bind: { prefix: 'comprador', nombre: 'comprador' } },
    ],
    sections: [
      s('Partes', `
        Contrato de compraventa celebrado en {{ciudad_firma}} el {{fecha_firma}} entre {{vendedor}} ("el Vendedor") y {{comprador}} ("el Comprador").`),
      s('Objeto', `
        El Vendedor vende y el Comprador adquiere el siguiente bien: {{descripcion_bien}} (el "Bien"), libre de gravámenes y en el estado en que se encuentra, mismo que el Comprador declara conocer.`),
      s('Precio', `
        El precio del Bien es de {{precio}}, que el Comprador pagará a la entrega del mismo.`),
      s('Entrega', `
        El Bien se entregará el {{fecha_entrega}} en {{lugar_entrega}}. La propiedad y el riesgo se transmiten al Comprador al momento de la entrega y pago.`),
      s('Jurisdicción', `
        Las partes se someten a los tribunales competentes de {{jurisdiccion}}.`),
    ],
  },
  {
    id: 'en-blanco',
    category: 'comercial',
    name: 'Documento en blanco',
    description: 'Empieza desde cero y arma tu acuerdo sección por sección.',
    vars: [...COMMON],
    signers: [
      { role: 'Parte A', name: '', bind: { prefix: 'a' } },
      { role: 'Parte B', name: '', bind: { prefix: 'b' } },
    ],
    sections: [s('Partes', 'Acuerdo celebrado en {{ciudad_firma}} el {{fecha_firma}} entre ...')],
  },
];

export const CLAUSES = [
  s('Confidencialidad', `Las partes mantendrán en estricta confidencialidad la información que reciban con motivo de este contrato y no la divulgarán a terceros sin consentimiento previo y por escrito, salvo mandato de ley o de autoridad competente.`),
  s('Pena convencional', `En caso de incumplimiento de cualquiera de las obligaciones de este contrato, la parte incumplida pagará a la otra una pena convencional de {{pena_convencional}}, sin perjuicio de la indemnización por daños y perjuicios.`),
  s('Caso fortuito o fuerza mayor', `Ninguna de las partes será responsable por el incumplimiento derivado de caso fortuito o fuerza mayor, siempre que lo notifique a la otra parte dentro de los 5 días hábiles siguientes y realice esfuerzos razonables para mitigar sus efectos.`),
  s('No competencia', `Durante la vigencia de este contrato y por {{meses_no_competencia}} meses posteriores, la parte obligada no desarrollará actividades que compitan directamente con la otra parte en el mismo territorio.`),
  s('No solicitación', `Durante la vigencia de este contrato y por 12 meses posteriores, ninguna de las partes contratará ni intentará contratar al personal de la otra parte sin su consentimiento por escrito.`),
  s('Cesión del contrato', `Ninguna de las partes podrá ceder sus derechos u obligaciones derivados de este contrato sin el consentimiento previo y por escrito de la otra parte.`),
  s('Modificaciones', `Cualquier modificación a este contrato deberá constar por escrito y estar firmada por ambas partes.`),
  s('Acuerdo total', `Este contrato constituye el acuerdo total entre las partes respecto de su objeto y sustituye cualquier acuerdo previo, verbal o escrito.`),
  s('Divisibilidad', `Si alguna disposición de este contrato fuera declarada nula o inválida, las demás disposiciones conservarán su plena validez.`),
  s('Propiedad intelectual', `Los derechos de propiedad intelectual sobre los materiales desarrollados en ejecución de este contrato pertenecerán a {{titular_pi}}, una vez cubierta la contraprestación correspondiente.`),
  s('Protección de datos personales', `Las partes tratarán los datos personales a los que tengan acceso conforme a la legislación aplicable en materia de protección de datos, únicamente para los fines de este contrato y con las medidas de seguridad adecuadas.`),
  s('Firma electrónica y ejemplares', `Las partes reconocen la validez de las firmas electrónicas o autógrafas digitalizadas en este contrato, el cual podrá firmarse en varios ejemplares que en conjunto constituirán un solo instrumento.`),
  s('Solución de controversias por mediación', `Antes de acudir a tribunales, las partes intentarán resolver cualquier controversia mediante mediación, durante un plazo de 30 días naturales contados a partir de que una parte notifique a la otra la existencia del conflicto.`),
  s('Anexos', `Forman parte integrante de este contrato los anexos firmados por las partes. En caso de contradicción, prevalecerá lo dispuesto en el cuerpo del contrato.`),
];
