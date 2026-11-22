const field=(key,label,extra={})=>({key,label,...extra});
const text=(key,label,help='')=>field(key,label,{type:'long',help});
const step=(key,title,prompt,fields=[],extra={})=>({key,title,prompt,fields,...extra});

export function photoPlan(order) {
  if(order.product_id==='album-complet') return {min:10,max:20,target:20,title:'De 10 à 20 photos pour votre Album Émotion Complet',help:'Votre formule prévoit de 10 à 20 photos. Choisissez celles qui racontent le mieux votre histoire, dans l’ordre souhaité.',categories:{photos:'Photos de mon album'},album:true};
  if(order.category==='album') return {min:1,max:10,target:10,title:'De 1 à 10 photos pour votre Album Émotion Mini',help:'Votre formule prévoit de 1 à 10 photos. Commencez par celle que vous aimeriez en couverture.',categories:{photos:'Photos de mon album'},album:true};
  const plans={
    mariage:{target:5,title:'Choisissez idéalement 5 photos de vous deux',help:'Ajoutez les 5 photos de couple qui vous tiennent le plus à cœur. Vous pouvez aussi joindre un portrait de chacun, si vous souhaitez les utiliser dans votre invitation.',categories:{couple:'Photos de nous deux',portraits:'Portraits individuels',photos:'Autres souvenirs'}},
    anniversaire:{target:3,title:'Notre conseil : 3 à 5 photos de la personne à l’honneur',help:'Choisissez un beau portrait pour la couverture, puis quelques souvenirs qui donnent le sourire. Des photos prises à différentes époques peuvent très bien fonctionner.',categories:{photos:'Photos pour mon anniversaire'}},
    naissance:{target:3,title:'Notre conseil : 3 à 5 photos de votre petit bonheur',help:'Un portrait de bébé, quelques détails et, si vous le souhaitez, une photo en famille. Si bébé n’est pas encore arrivé, vous pouvez nous les transmettre plus tard.',categories:{photos:'Photos de bébé et de la famille'}},
    hommage:{target:1,title:'Un portrait qui vous est cher',help:'Un seul portrait peut suffire. Vous pouvez ajouter quelques souvenirs si vous le souhaitez, ou demander une création sans photo.',categories:{photos:'Portrait et souvenirs'}}
  };
  return {min:1,max:10,...plans[order.category],album:false};
}

export function intakeSpec(order) {
  const kind=order.category;
  const photos=photoPlan(order);
  const intro={
    mariage:['Félicitations pour votre commande !','Votre invitation de mariage commence ici. Racontez-nous votre histoire, partagez les détails de ce grand jour et choisissez vos photos. Nous vous accompagnons, une question après l’autre.'],
    anniversaire:['Une belle fête se prépare !','Merci pour votre commande. Faisons connaissance avec la personne que vous allez célébrer, puis préparons ensemble une invitation qui lui ressemble.'],
    naissance:['Un petit bonheur à annoncer','Merci pour votre confiance. Pour préparer votre faire-part de naissance, parlez-nous de votre famille, de votre bébé et de ce que vous aimeriez partager avec vos proches.'],
    hommage:['Nous sommes à vos côtés','Merci de nous confier cette création. Nous allons vous guider avec douceur pour recueillir les informations et les souvenirs que vous souhaitez partager. Prenez le temps dont vous avez besoin.'],
    album:['Vos souvenirs méritent une belle histoire','Merci pour votre commande. Choisissons ensemble les souvenirs, les mots et les photos qui donneront vie à votre Album Émotion.']
  }[kind];
  const steps=[step('bienvenue',intro[0],intro[1],[],{intro:true})];
  if(kind==='mariage') steps.push(
    step('vous','Commençons par vous deux','Quels noms et prénoms souhaitez-vous nous confier pour votre invitation ?',[
      field('first','Prénom de la première personne',{required:true}),field('first_last','Nom de la première personne',{required:true}),field('second','Prénom de la deuxième personne',{required:true}),field('second_last','Nom de la deuxième personne',{required:true})],{simpleNames:true}),
    step('rencontre','Comment vous êtes-vous rencontrés ?','Un lieu, une date, un hasard… Racontez-nous ce premier moment, avec vos mots.',[text('story_meeting','Votre rencontre','Quelques phrases suffisent. Vous pouvez aussi nous confier une anecdote.')],{optional:true}),
    step('debuts','Et vos premiers moments à deux ?','Votre premier rendez-vous, votre première escapade ou ce moment où vous avez su que cette histoire était différente… Quel souvenir vous revient ?',[text('story_beginnings','Le souvenir de vos débuts')],{optional:true}),
    step('etapes','Quelles étapes ont marqué votre histoire ?','Un emménagement, un voyage, une naissance, une demande en mariage… Quels moments aimeriez-vous retrouver dans votre invitation ?',[text('story_milestones','Vos moments marquants')],{optional:true}),
    step('complicite','Qu’est-ce qui vous ressemble vraiment ?','Un petit rituel, un fou rire, une passion commune… Qu’aimeriez-vous que vos proches ressentent en découvrant votre invitation ?',[text('story_personality','Ce qui rend votre histoire unique')],{optional:true}),
    step('date','Quel jour vous direz-vous oui ?','Indiquons la date que vos proches devront retenir.',[field('date','Date du mariage',{type:'date',required:true})],{unknown:'La date n’est pas encore fixée'}),
    step('ceremonie','Où aura lieu la cérémonie ?','Donnez-nous le lieu, son adresse et l’horaire. S’il y a plusieurs cérémonies, précisez-les simplement dans le même champ.',[
      field('places','Lieu de la cérémonie',{required:true,placeholder:'Par exemple : mairie de Clermont-Ferrand'}),field('addresses','Adresse de la cérémonie'),field('times','Horaire de la cérémonie',{placeholder:'Par exemple : 15 h 30'})],{unknown:'Le lieu et les horaires restent à confirmer'}),
    step('reception','Et pour la suite de cette belle journée ?','Cocktail, dîner, brunch… Où retrouverez-vous vos proches après la cérémonie ?',[
      field('reception_place','Lieu de la réception'),field('reception_address','Adresse de la réception'),field('reception_time','Horaire de la réception'),text('agenda','Le programme que vous imaginez')],{optional:true}),
    step('proches','Les petits détails pour vos invités','Une tenue conseillée, une date limite pour répondre ou un contact à indiquer ? Aidez vos proches à préparer cette journée.',[
      field('deadline','Date limite de réponse',{type:'date'}),field('contact','Coordonnées de contact à afficher'),field('dress','Une tenue ou un thème à prévoir ?'),text('details','Autres informations pratiques')],{optional:true})
  );
  if(kind==='anniversaire') steps.push(
    step('vous','Qui allons-nous célébrer ?','Présentez-nous la personne à l’honneur : qui est-elle et quel âge va-t-elle fêter ?',[
      field('person','Son prénom',{required:true}),field('person_last','Son nom (facultatif)'),field('age','L’âge à célébrer (facultatif)')]),
    step('souvenirs','Quel souvenir la raconte le mieux ?','Une aventure, une passion, une anecdote drôle ou touchante… Racontez-nous ce qui la rend unique.',[text('story_personality','Son histoire, avec vos mots')],{optional:true}),
    step('intention','Quel esprit voulez-vous donner à cette fête ?','Une grande surprise, une soirée pleine d’humour ou des retrouvailles en famille ? Racontez-nous ce que vous imaginez.',[text('story_beginnings','La fête que vous imaginez')],{optional:true}),
    step('date','Quand aura lieu la fête ?','Choisissons la date à faire apparaître sur votre invitation.',[field('date','Date de la fête',{type:'date',required:true})],{unknown:'La date reste à confirmer'}),
    step('lieu','Où retrouver vos invités ?','Le lieu, son adresse et l’heure d’arrivée aideront vos proches à s’organiser.',[field('places','Lieu et adresse de la fête',{required:true}),field('times','À quelle heure ?'),field('deadline','Date limite de réponse',{type:'date'}),field('contact','Contact à indiquer')],{unknown:'Le lieu et l’horaire restent à confirmer'})
  );
  if(kind==='naissance') steps.push(
    step('vous','Comment s’appelle votre petit bonheur ?','Indiquez son prénom et les prénoms de la famille qui l’accueille. Si vous gardez encore la surprise, vous pourrez le préciser plus tard.',[field('person','Prénom de bébé',{required:true}),field('family','Prénoms des parents, frères et sœurs à afficher')],{unknown:'Le prénom reste encore une surprise, je le préciserai plus tard'}),
    step('date','Racontez-nous son arrivée','Quand votre bébé est-il arrivé ? Ces petits détails rendent votre faire-part encore plus personnel.',[field('date','Date de naissance',{type:'date',required:true}),field('times','Heure de naissance (facultatif)'),field('measures','Poids et taille (facultatif)')],{unknown:'Bébé n’est pas encore arrivé ou ces détails restent à préciser'}),
    step('bonheur','Quels mots racontent votre bonheur ?','Une émotion, une petite anecdote, un surnom tendre… Que voudriez-vous raconter de ces premiers moments ?',[text('story_meeting','Vos premiers moments avec bébé')],{optional:true}),
    step('annonce','Qu’aimeriez-vous dire à vos proches ?','Un message tout simple, une jolie phrase ou une pensée pour ceux qui vous entourent : écrivez comme vous parleriez à vos proches.',[text('copy','Votre petit mot pour annoncer la naissance')],{optional:true})
  );
  if(kind==='hommage') steps.push(
    step('vous','À qui souhaitez-vous rendre hommage ?','Indiquez le nom, le prénom et les dates que vous souhaitez faire apparaître.',[field('person','Prénom et nom',{required:true}),field('dates','Dates à afficher (facultatif)')]),
    step('souvenir','Quel souvenir souhaitez-vous partager ?','Une qualité, une passion, un geste du quotidien… Vous pouvez nous parler de la personne, simplement, avec les mots qui vous viennent.',[text('story_meeting','Le souvenir que vous souhaitez transmettre')],{optional:true}),
    step('message','Quels mots souhaitez-vous lui dédier ?','Un texte personnel, une citation ou quelques mots suffisent. Vous pouvez aussi nous laisser vous accompagner dans la rédaction.',[text('copy','Votre texte d’hommage')],{optional:true}),
    step('ceremonie','Y a-t-il une cérémonie à annoncer ?','Si vous le souhaitez, précisez les informations que les proches doivent connaître.',[field('date','Date de la cérémonie',{type:'date'}),field('times','Horaire de la cérémonie'),field('places','Lieu et adresse de la cérémonie'),text('details','Autres informations à transmettre')],{optional:true})
  );
  if(kind==='album') steps.push(
    step('titre','Quel titre donner à vos souvenirs ?','Un prénom, une date ou quelques mots qui vous ressemblent : comment souhaitez-vous ouvrir cet album ?',[
      field('title','Titre de votre album',{required:true}),field('date','Une date à mettre en avant (facultatif)',{type:'date'})]),
    step('histoire','Quelle histoire racontent ces photos ?','Un voyage, une année, des retrouvailles… Racontez-nous le fil de ces souvenirs.',[text('story_meeting','L’histoire de votre album')],{optional:true}),
    step('moments','Quels moments comptent le plus pour vous ?','Dites-nous quelles photos mettre en avant, l’ordre souhaité et les petits mots qui les accompagnent.',[text('copy','Vos souvenirs, légendes et indications')],{optional:true})
  );
  steps.push(
    step('univers','Quel univers vous ressemble ?',kind==='hommage'?'Préférez-vous un hommage sobre, doux ou inspiré par une passion ? Quelques mots peuvent nous guider.':'Doux, élégant, joyeux, naturel… Imaginez l’émotion que vous aimeriez transmettre en ouvrant votre création.',[
      field('mood','L’ambiance que vous aimez',{placeholder:'Par exemple : naturel, chaleureux et lumineux'}),field('colors','Vos couleurs préférées (facultatif)'),...(kind==='mariage'||kind==='anniversaire'?[text('copy','Un petit mot à faire apparaître (facultatif)')]:[])],{optional:true}),
    step('photos','Place à vos photos',photos.help,[],{photos:true}),
    step('recap','Tout vous ressemble ?','Relisez tranquillement vos réponses et votre sélection de photos. Vous pouvez revenir sur chaque étape avant de nous confier votre création.',[],{review:true})
  );
  return {steps,photos,intro:intro[0]};
}

export function assembledBrief(order,old,draft) {
  const result={...old,...draft};
  const stories=[['story_meeting','Notre rencontre'],['story_beginnings','Nos débuts'],['story_milestones','Les grandes étapes'],['story_personality','Ce qui nous ressemble']];
  const narrative=stories.filter(([k])=>result[k]).map(([k,label])=>`${order.category==='mariage'?label:'Nos souvenirs'}\n${result[k]}`).join('\n\n');
  if(narrative || stories.some(([key])=>Object.hasOwn(draft,key))) result.story=narrative;
  return result;
}
