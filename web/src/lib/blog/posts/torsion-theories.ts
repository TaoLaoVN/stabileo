/**
 * The second post: which torsion theory applies, and what picking wrong costs.
 *
 * Every figure here was computed before it was written, not remembered:
 *
 *   · The Bredt-vs-exact table is the closed forms for a circular hollow tube,
 *     τ_exact = T·r_o/J with J = π(r_o⁴−r_i⁴)/2 against τ_Bredt = T/(2·A_m·t)
 *     with A_m = π·r_m². At t/r_m = 0.10 Bredt lands 4.5% low; at 0.50, 15%.
 *   · The slit-tube collapse is a 100×100×5 square tube: J goes from
 *     4,286,875 mm⁴ closed to 15,833 mm⁴ open, a factor of 271, and under
 *     1 kN·m the stress goes from 11.08 to 315.79 MPa, a factor of 29.
 *
 * They are quoted to the precision they were computed at and no further. If
 * one ever needs changing, recompute it — do not adjust it to read better.
 *
 * The lesson the post is built around is one the application already teaches
 * in `stress.tt.bredtCircular`: Bredt sits BELOW Cauchy on a circular tube,
 * which makes it approximate in the unsafe direction. The post exists to put
 * a number on "below".
 */
import type { Post } from '../types';

export const torsionTheories: Post = {
  slug: 'torsion-bredt-saint-venant',
  date: '2026-08-21',
  authors: ['Bautista Chesta'],
  tagKeys: ['blog.tag.sections', 'blog.tag.theory'],
  i18n: {
    es: {
      title: 'Bredt o Saint-Venant: qué teoría de torsión aplica, y qué cuesta elegir mal',
      excerpt:
        'Tres fórmulas, una sección, tres números distintos. Cuál vale no lo decide el tamaño sino la topología de la pared — y cuando dos se aplican a la vez, la diferencia tiene signo: Bredt queda por debajo, que es el lado inseguro.',
      blocks: [
        { k: 'p', t: 'La torsión es el lugar donde "depende de la sección" deja de ser una advertencia y pasa a ser el tema. Tres teorías con nombre propio se reparten el problema, dan respuestas que difieren en órdenes de magnitud para la misma área de sección, y cuál se aplica no lo decide el tamaño, ni el material, ni la inercia: lo decide la topología de la pared.' },
        { k: 'p', t: 'Eso ya es incómodo. Lo que casi nunca se dice es lo que pasa cuando dos se aplican a la misma sección, porque entonces no dan el mismo número — y la diferencia tiene un signo.' },

        { k: 'h', t: 'Las tres, en una línea cada una' },
        {
          k: 'ul',
          items: [
            'Cauchy, τ = T·r / Iₚ. Sólo para sección circular, y ahí es exacta: es el único caso en que las secciones planas siguen planas. La tensión crece linealmente con el radio, mínima adentro y máxima en la cara exterior.',
            'Bredt, τ = T / (2·Aₘ·t). Para pared delgada CERRADA. El torsor lo toma un flujo de corte que circula alrededor del área encerrada. Aₘ es el área que encierra la LÍNEA MEDIA de la pared, no su cara exterior — confundirlas es el error clásico.',
            'Saint-Venant, τ = T·t / J con J = (1/3)·Σb·t³. Para pared delgada ABIERTA. Sin circuito cerrado el flujo tiene que darse vuelta sobre sí mismo cruzando el espesor, y por eso el espesor entra al cubo.',
          ],
        },
        { k: 'note', t: 'Saint-Venant no es la teoría "de las secciones abiertas": es la teoría general, y las otras dos son sus casos particulares con solución cerrada. En una sección circular su solución coincide exactamente con Cauchy, porque por simetría circular la sección no alabea. En pared cerrada delgada, su solución ES la de Bredt.' },

        { k: 'h', t: 'Cuando dos se aplican, no coinciden' },
        { k: 'p', t: 'Tomá un tubo circular. Cauchy se aplica y es exacta. Bredt también se aplica: hay una pared cerrada y un flujo que circula. Pero Bredt supone que la tensión es constante en el espesor, y Cauchy sabe que crece con el radio. Así que Bredt reporta un promedio donde Cauchy reporta el máximo.' },
        {
          k: 'table',
          caption: 'Tubo circular hueco: cuánto queda Bredt por debajo del valor exacto, según el espesor relativo de la pared.',
          head: ['t / rₘ', 'Ejemplo (rₘ = 50 mm)', 'τ Bredt / τ exacta', 'Bredt queda por debajo'],
          rows: [
            ['0,05', 'pared 2,5 mm', '0,976', '2,4 %'],
            ['0,10', 'pared 5,0 mm', '0,955', '4,5 %'],
            ['0,20', 'pared 10,0 mm', '0,918', '8,2 %'],
            ['0,50', 'pared 25,0 mm', '0,850', '15,0 %'],
          ],
        },
        { k: 'p', t: 'Mirá la última columna y fijate en el signo. Bredt no se equivoca de cualquier lado: se equivoca siempre para abajo. En un tubo de pared 5 mm sobre radio medio 50 mm —que por la regla habitual todavía cuenta como pared delgada— la tensión real es 4,5 % mayor que la que calculaste. Con pared 10 mm, 8,2 %.' },
        { k: 'quote', t: 'Una aproximación que subestima la tensión no es conservadora. Es un margen de seguridad que creíste tener.' },
        { k: 'p', t: 'No es un error grosero, y ése es el punto: 4,5 % no aparece en ninguna verificación como algo raro. Aparece como que verifica.' },

        { k: 'h', t: 'Y cuando cambia la topología, cambia todo' },
        { k: 'p', t: 'La diferencia entre teorías que se solapan es de unidades por ciento. La diferencia entre pared cerrada y abierta es de otro orden. Tomá un tubo cuadrado de 100×100 mm con 5 mm de pared y hacele una ranura a lo largo. No cambió el área, ni el peso, ni prácticamente la inercia a flexión.' },
        {
          k: 'table',
          caption: 'El mismo tubo cuadrado 100×100×5, cerrado y con una ranura longitudinal, bajo un torsor de 1 kN·m.',
          head: ['', 'Cerrado', 'Con ranura', 'Factor'],
          rows: [
            ['J [mm⁴]', '4.286.875', '15.833', '271'],
            ['τ [MPa]', '11,08', '315,79', '29'],
          ],
        },
        { k: 'p', t: 'La rigidez torsional cae 271 veces y la tensión se multiplica por 29. Un perfil C y un tubo cuadrado del mismo peso no son remotamente el mismo elemento en torsión, y la foto de la sección no te lo va a decir.' },
        { k: 'note', t: 'Falta un término que se omite más de lo que se debería: el alabeo. En una sección abierta que no puede alabear libremente —porque está empotrada, o porque el torsor varía a lo largo— aparece una torsión por alabeo que se suma a la de Saint-Venant. Omitirla también subestima.' },

        { k: 'h', t: 'Qué hace Stabileo con esto' },
        { k: 'p', t: 'Muestra las tres. No la que corresponde: las tres, cada una con su fórmula, sus términos y su valor, incluidas las que NO se aplican, diciendo por qué no. Y cuando dos son válidas para la misma sección, muestra la diferencia entre ellas en vez de elegir en silencio.' },
        { k: 'p', t: 'Eso último es la parte que no se suele encontrar en ningún lado. Un programa te da un número; acá podés ver el número, la hipótesis que hay atrás, y qué pasa cuando esa hipótesis deja de valer. Es lo mismo que hace con el baricentro, el centro de corte y el núcleo central: se derivan a la vista, paso a paso, sobre el polígono real de la sección y no sobre una fórmula por forma.' },
        { k: 'note', t: 'Para verlo: abrí el editor, dibujá o elegí una barra, y entrá en Avanzado → Análisis de sección → Torsión. Con un tubo circular vas a ver a Cauchy y a Bredt convivir, y el porcentaje entre las dos. Con un perfil C vas a ver a Bredt marcada como no aplicable, y por qué.' },

        { k: 'h', t: 'La regla, corta' },
        {
          k: 'ol',
          items: [
            '¿La pared forma un circuito cerrado? Bredt, con Aₘ medida sobre la línea media.',
            '¿Es abierta? Saint-Venant, y el espesor entra al cubo: gobierna la pared más gruesa.',
            '¿Es circular? Cauchy, y es exacta. Si además usás Bredt, sabé que vas a quedar por debajo.',
            '¿Está impedido el alabeo? Entonces Saint-Venant sola no alcanza.',
          ],
        },
        { k: 'p', t: 'Y la que vale para todo caso: la teoría que usaste es parte del resultado. Un número de torsión sin la hipótesis que lo produjo es medio resultado.' },

        { k: 'note', t: 'Los valores de esta nota son fórmulas cerradas calculadas para las secciones que se indican, no estimaciones: tubo circular hueco con Aₘ sobre la línea media, y tubo cuadrado 100×100×5 con J cerrado por Bredt y J abierto por Saint-Venant. Podés reproducirlos en Stabileo con esas mismas secciones.' },
      ],
    },

    en: {
      title: 'Bredt or Saint-Venant: which torsion theory applies, and what picking wrong costs',
      excerpt:
        'Three formulas, one section, three different numbers. Which one holds is decided by the topology of the wall rather than its size — and where two apply at once, the difference has a sign: Bredt lands below, which is the unsafe side.',
      blocks: [
        { k: 'p', t: 'Torsion is where "it depends on the section" stops being a caveat and becomes the subject. Three named theories share the problem, they give answers that differ by orders of magnitude for the same section area, and which one applies is not decided by size, material or inertia: it is decided by the topology of the wall.' },
        { k: 'p', t: 'That much is awkward already. What is rarely said is what happens when two of them apply to the same section, because then they do not agree — and the disagreement has a sign.' },

        { k: 'h', t: 'The three, one line each' },
        {
          k: 'ul',
          items: [
            'Cauchy, τ = T·r / Iₚ. Circular sections only, and there it is exact: the one case where plane sections stay plane. Stress grows linearly with radius, least on the inside and greatest at the outer face.',
            'Bredt, τ = T / (2·Aₘ·t). For a CLOSED thin wall. The torque is carried by a shear flow circulating around the enclosed area. Aₘ is the area enclosed by the wall’s MID-LINE, not by its outer face — confusing the two is the classic error.',
            'Saint-Venant, τ = T·t / J with J = (1/3)·Σb·t³. For an OPEN thin wall. With no closed circuit the flow has to turn back on itself across the thickness, which is why thickness enters cubed.',
          ],
        },
        { k: 'note', t: 'Saint-Venant is not "the open-section theory": it is the general one, and the other two are its closed-form special cases. On a circular section its solution coincides exactly with Cauchy, because circular symmetry means the section does not warp. On a closed thin wall, its solution IS Bredt’s.' },

        { k: 'h', t: 'Where two apply, they disagree' },
        { k: 'p', t: 'Take a circular tube. Cauchy applies and is exact. Bredt applies too: there is a closed wall and a flow running round it. But Bredt assumes the stress is constant through the thickness, and Cauchy knows it grows with radius. So Bredt reports an average where Cauchy reports the maximum.' },
        {
          k: 'table',
          caption: 'Circular hollow tube: how far below the exact value Bredt lands, by relative wall thickness.',
          head: ['t / rₘ', 'Example (rₘ = 50 mm)', 'τ Bredt / τ exact', 'Bredt lands below by'],
          rows: [
            ['0.05', '2.5 mm wall', '0.976', '2.4 %'],
            ['0.10', '5.0 mm wall', '0.955', '4.5 %'],
            ['0.20', '10.0 mm wall', '0.918', '8.2 %'],
            ['0.50', '25.0 mm wall', '0.850', '15.0 %'],
          ],
        },
        { k: 'p', t: 'Look at the last column, and at its sign. Bredt does not err in either direction: it errs low, always. On a tube with a 5 mm wall over a 50 mm mean radius — still thin-walled by the usual rule of thumb — the real stress is 4.5% higher than the one you computed. At 10 mm, 8.2%.' },
        { k: 'quote', t: 'An approximation that underestimates the stress is not conservative. It is a safety margin you believed you had.' },
        { k: 'p', t: 'It is not a gross error, and that is the point: 4.5% does not show up in any check as something odd. It shows up as passing.' },

        { k: 'h', t: 'And when the topology changes, everything does' },
        { k: 'p', t: 'The disagreement between overlapping theories is a few per cent. The difference between a closed and an open wall is another order entirely. Take a 100×100 mm square tube with a 5 mm wall and slit it lengthwise. The area has not changed, nor the weight, nor — to any useful precision — the bending inertia.' },
        {
          k: 'table',
          caption: 'The same 100×100×5 square tube, closed and slit lengthwise, under a 1 kN·m torque.',
          head: ['', 'Closed', 'Slit', 'Factor'],
          rows: [
            ['J [mm⁴]', '4,286,875', '15,833', '271'],
            ['τ [MPa]', '11.08', '315.79', '29'],
          ],
        },
        { k: 'p', t: 'Torsional stiffness falls by a factor of 271 and the stress multiplies by 29. A C-channel and a square tube of the same weight are not remotely the same member in torsion, and a picture of the section will not tell you.' },
        { k: 'note', t: 'One term gets left out more than it should: warping. In an open section that cannot warp freely — because it is fixed, or because the torque varies along the member — a warping torsion appears on top of the Saint-Venant one. Leaving it out also underestimates.' },

        { k: 'h', t: 'What Stabileo does with this' },
        { k: 'p', t: 'It shows all three. Not the one that applies: all three, each with its formula, its terms and its value, including the ones that do NOT apply, saying why not. And when two are valid for the same section, it shows the difference between them instead of choosing silently.' },
        { k: 'p', t: 'That last part is the one that is hard to find anywhere. A program gives you a number; here you can see the number, the hypothesis behind it, and what happens when that hypothesis stops holding. It is the same treatment the centroid, the shear centre and the core get: derived in view, step by step, on the real polygon of the section rather than on a per-shape formula.' },
        { k: 'note', t: 'To see it: open the editor, draw or pick a member, and go to Advanced → Section analysis → Torsion. On a circular tube you will find Cauchy and Bredt side by side with the percentage between them. On a C-channel you will find Bredt marked as not applicable, and why.' },

        { k: 'h', t: 'The rule, short' },
        {
          k: 'ol',
          items: [
            'Does the wall form a closed circuit? Bredt, with Aₘ measured on the mid-line.',
            'Is it open? Saint-Venant, and thickness enters cubed: the thickest wall governs.',
            'Is it circular? Cauchy, and it is exact. If you use Bredt as well, know that you will land low.',
            'Is warping restrained? Then Saint-Venant alone is not enough.',
          ],
        },
        { k: 'p', t: 'And the one that holds in every case: the theory you used is part of the result. A torsion number without the hypothesis that produced it is half an answer.' },

        { k: 'note', t: 'The figures here are closed forms computed for the sections named, not estimates: a circular hollow tube with Aₘ on the mid-line, and a 100×100×5 square tube with J closed by Bredt and J open by Saint-Venant. You can reproduce them in Stabileo with those same sections.' },
      ],
    },

    pt: {
      title: 'Bredt ou Saint-Venant: qual teoria de torção se aplica, e o que custa escolher errado',
      excerpt:
        'Três fórmulas, uma seção, três números diferentes. Qual vale não é decidido pelo tamanho e sim pela topologia da parede — e quando duas se aplicam ao mesmo tempo, a diferença tem sinal: Bredt fica abaixo, que é o lado inseguro.',
      blocks: [
        { k: 'p', t: 'A torção é o lugar onde "depende da seção" deixa de ser uma ressalva e passa a ser o assunto. Três teorias com nome próprio dividem o problema, dão respostas que diferem em ordens de grandeza para a mesma área de seção, e qual delas se aplica não é decidido pelo tamanho, nem pelo material, nem pela inércia: é decidido pela topologia da parede.' },
        { k: 'p', t: 'Isso já é incômodo. O que quase nunca se diz é o que acontece quando duas se aplicam à mesma seção, porque então elas não dão o mesmo número — e a diferença tem sinal.' },

        { k: 'h', t: 'As três, uma linha cada' },
        {
          k: 'ul',
          items: [
            'Cauchy, τ = T·r / Iₚ. Apenas para seção circular, e aí é exata: é o único caso em que as seções planas permanecem planas. A tensão cresce linearmente com o raio, mínima por dentro e máxima na face externa.',
            'Bredt, τ = T / (2·Aₘ·t). Para parede fina FECHADA. O torque é absorvido por um fluxo de cisalhamento que circula ao redor da área fechada. Aₘ é a área delimitada pela LINHA MÉDIA da parede, não pela face externa — confundir as duas é o erro clássico.',
            'Saint-Venant, τ = T·t / J com J = (1/3)·Σb·t³. Para parede fina ABERTA. Sem circuito fechado, o fluxo tem de se voltar sobre si mesmo atravessando a espessura, e por isso a espessura entra ao cubo.',
          ],
        },
        { k: 'note', t: 'Saint-Venant não é "a teoria das seções abertas": é a geral, e as outras duas são seus casos particulares com solução fechada. Numa seção circular sua solução coincide exatamente com Cauchy, porque por simetria circular a seção não empena. Em parede fechada fina, sua solução É a de Bredt.' },

        { k: 'h', t: 'Onde duas se aplicam, elas discordam' },
        { k: 'p', t: 'Pegue um tubo circular. Cauchy se aplica e é exata. Bredt também se aplica: há uma parede fechada e um fluxo circulando. Mas Bredt supõe que a tensão é constante na espessura, e Cauchy sabe que ela cresce com o raio. Então Bredt reporta uma média onde Cauchy reporta o máximo.' },
        {
          k: 'table',
          caption: 'Tubo circular vazado: quanto Bredt fica abaixo do valor exato, conforme a espessura relativa da parede.',
          head: ['t / rₘ', 'Exemplo (rₘ = 50 mm)', 'τ Bredt / τ exata', 'Bredt fica abaixo em'],
          rows: [
            ['0,05', 'parede 2,5 mm', '0,976', '2,4 %'],
            ['0,10', 'parede 5,0 mm', '0,955', '4,5 %'],
            ['0,20', 'parede 10,0 mm', '0,918', '8,2 %'],
            ['0,50', 'parede 25,0 mm', '0,850', '15,0 %'],
          ],
        },
        { k: 'p', t: 'Olhe a última coluna e repare no sinal. Bredt não erra para qualquer lado: erra sempre para baixo. Num tubo de parede 5 mm sobre raio médio 50 mm — que pela regra prática ainda conta como parede fina — a tensão real é 4,5 % maior do que a que você calculou. Com parede 10 mm, 8,2 %.' },
        { k: 'quote', t: 'Uma aproximação que subestima a tensão não é conservadora. É uma margem de segurança que você acreditou ter.' },
        { k: 'p', t: 'Não é um erro grosseiro, e esse é justamente o ponto: 4,5 % não aparece em nenhuma verificação como algo estranho. Aparece como aprovado.' },

        { k: 'h', t: 'E quando a topologia muda, muda tudo' },
        { k: 'p', t: 'A discordância entre teorias que se sobrepõem é de alguns por cento. A diferença entre parede fechada e aberta é de outra ordem. Pegue um tubo quadrado de 100×100 mm com parede de 5 mm e faça um corte longitudinal. Não mudou a área, nem o peso, nem — com qualquer precisão útil — a inércia à flexão.' },
        {
          k: 'table',
          caption: 'O mesmo tubo quadrado 100×100×5, fechado e com um corte longitudinal, sob um torque de 1 kN·m.',
          head: ['', 'Fechado', 'Cortado', 'Fator'],
          rows: [
            ['J [mm⁴]', '4.286.875', '15.833', '271'],
            ['τ [MPa]', '11,08', '315,79', '29'],
          ],
        },
        { k: 'p', t: 'A rigidez à torção cai 271 vezes e a tensão se multiplica por 29. Um perfil C e um tubo quadrado do mesmo peso não são nem de longe o mesmo elemento em torção, e a foto da seção não vai lhe dizer isso.' },
        { k: 'note', t: 'Falta um termo que é omitido mais do que deveria: o empenamento. Numa seção aberta que não pode empenar livremente — porque está engastada, ou porque o torque varia ao longo da barra — surge uma torção por empenamento que se soma à de Saint-Venant. Omiti-la também subestima.' },

        { k: 'h', t: 'O que o Stabileo faz com isso' },
        { k: 'p', t: 'Mostra as três. Não a que corresponde: as três, cada uma com sua fórmula, seus termos e seu valor, incluídas as que NÃO se aplicam, dizendo por que não. E quando duas são válidas para a mesma seção, mostra a diferença entre elas em vez de escolher em silêncio.' },
        { k: 'p', t: 'Essa última parte é a que dificilmente se encontra em algum lugar. Um programa lhe dá um número; aqui você pode ver o número, a hipótese que está por trás, e o que acontece quando essa hipótese deixa de valer. É o mesmo tratamento que recebem o baricentro, o centro de cisalhamento e o núcleo central: derivados à vista, passo a passo, sobre o polígono real da seção e não sobre uma fórmula por forma.' },
        { k: 'note', t: 'Para ver: abra o editor, desenhe ou escolha uma barra, e vá em Avançado → Análise de seção → Torção. Num tubo circular você vai encontrar Cauchy e Bredt lado a lado, com a porcentagem entre as duas. Num perfil C vai encontrar Bredt marcada como não aplicável, e por quê.' },

        { k: 'h', t: 'A regra, curta' },
        {
          k: 'ol',
          items: [
            'A parede forma um circuito fechado? Bredt, com Aₘ medida sobre a linha média.',
            'É aberta? Saint-Venant, e a espessura entra ao cubo: governa a parede mais grossa.',
            'É circular? Cauchy, e é exata. Se você também usar Bredt, saiba que vai ficar abaixo.',
            'O empenamento está impedido? Então Saint-Venant sozinha não basta.',
          ],
        },
        { k: 'p', t: 'E a que vale em todo caso: a teoria que você usou é parte do resultado. Um número de torção sem a hipótese que o produziu é meia resposta.' },

        { k: 'note', t: 'Os valores desta nota são fórmulas fechadas calculadas para as seções indicadas, não estimativas: tubo circular vazado com Aₘ sobre a linha média, e tubo quadrado 100×100×5 com J fechado por Bredt e J aberto por Saint-Venant. Você pode reproduzi-los no Stabileo com essas mesmas seções.' },
      ],
    },
  },
};
