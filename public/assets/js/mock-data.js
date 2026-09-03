window.STUDIO_MOCK = {
  views: [
    {name:'AA_URETIM_MALZEME_PLANLAMA',health:38,risk:'critical',riskScore:92,depth:6,tables:9,dependents:27,reads:'4.1B',median:'284s',modified:'03.09.2026 16:47'},
    {name:'AA_ISEMRI_MALZEME_DURUMLARI',health:44,risk:'critical',riskScore:88,depth:5,tables:7,dependents:18,reads:'2.7B',median:'96s',modified:'02.09.2026 14:10'},
    {name:'AA_STOK_HAREKET_OZET',health:49,risk:'high',riskScore:76,depth:4,tables:5,dependents:31,reads:'1.8B',median:'18.4s',modified:'28.08.2026 11:33'},
    {name:'AA_ldrprog_mamulstoklar',health:56,risk:'high',riskScore:69,depth:4,tables:6,dependents:22,reads:'984M',median:'8.2s',modified:'30.08.2026 09:18'},
    {name:'AA_ldrprog_yurtiçi_genel',health:61,risk:'high',riskScore:65,depth:3,tables:8,dependents:14,reads:'812M',median:'5.1s',modified:'27.08.2026 15:42'},
    {name:'AA_STOK_DURUMU',health:58,risk:'high',riskScore:63,depth:4,tables:6,dependents:29,reads:'702M',median:'4.8s',modified:'25.08.2026 10:04'},
    {name:'AA_SIPARIS_KALAN',health:71,risk:'medium',riskScore:48,depth:3,tables:4,dependents:17,reads:'388M',median:'2.6s',modified:'22.08.2026 08:51'},
    {name:'AA_URETIM_EMIRLERI',health:67,risk:'medium',riskScore:46,depth:3,tables:5,dependents:12,reads:'344M',median:'2.1s',modified:'21.08.2026 17:20'},
    {name:'AA_DEPO_BAKIYE',health:76,risk:'medium',riskScore:38,depth:2,tables:3,dependents:8,reads:'202M',median:'1.4s',modified:'19.08.2026 12:14'},
    {name:'AA_CARI_SIPARIS_OZET',health:84,risk:'low',riskScore:22,depth:2,tables:3,dependents:5,reads:'74M',median:'0.8s',modified:'11.08.2026 13:21'},
    {name:'AA_URUN_AGACI',health:88,risk:'low',riskScore:18,depth:2,tables:4,dependents:9,reads:'66M',median:'0.6s',modified:'09.08.2026 16:36'},
    {name:'AA_DEPO_LISTESI',health:93,risk:'low',riskScore:11,depth:1,tables:1,dependents:3,reads:'12M',median:'0.2s',modified:'03.08.2026 09:12'}
  ],
  pressures: [
    {name:'STOK_HAREKETLERI',refs:183,paths:647,critical:27,score:96,repeated:94},
    {name:'STOKLAR',refs:211,paths:522,critical:18,score:84,repeated:62},
    {name:'ISEMIRLERI',refs:74,paths:241,critical:16,score:71,repeated:37},
    {name:'SIPARISLER',refs:96,paths:218,critical:11,score:65,repeated:22},
    {name:'URETIM_MALZEME_PLANLAMA',refs:43,paths:119,critical:9,score:59,repeated:18},
    {name:'PARTILOT',refs:51,paths:102,critical:5,score:47,repeated:9}
  ],
  problems: [
    {symbol:'⇄',title:'Repeated base table access',detail:'STOK_HAREKETLERI is reached through 4 logical branches.',severity:'CRITICAL',penalty:18},
    {symbol:'∿',title:'Performance regression',detail:'Median duration increased from 0.94s to 284s.',severity:'CRITICAL',penalty:16},
    {symbol:'∞',title:'Dependency depth',detail:'6 levels deep; optimizer must expand a large nested tree.',severity:'HIGH',penalty:9},
    {symbol:'ƒ',title:'Non-SARGable expressions',detail:'CONVERT / ISNULL patterns detected around predicates or join expressions.',severity:'HIGH',penalty:8},
    {symbol:'≋',title:'Cardinality mismatch',detail:'Estimated 1 row, actual 187,431 rows in a nested-loops branch.',severity:'CRITICAL',penalty:16},
    {symbol:'⊛',title:'Large blast radius',detail:'27 dependent objects can be affected by semantic changes.',severity:'MEDIUM',penalty:5}
  ],
  riskBars:[
    {label:'Runtime / Regression',value:92,penalty:16},
    {label:'Repeated Access',value:86,penalty:18},
    {label:'Dependency Depth',value:68,penalty:9},
    {label:'SARGability',value:59,penalty:8},
    {label:'Blast Radius',value:54,penalty:5}
  ],
  plans:[
    {time:'03.09.2026 17:09',title:'Plan #8812 · active',detail:'Nested Loops + Key Lookup · avg logical reads 3.48M',state:'Regression +30,112%'},
    {time:'03.09.2026 08:14',title:'Plan #8779 · previous good',detail:'Hash Match + Seek · avg logical reads 41.2K',state:'0.94s median'},
    {time:'02.09.2026 14:45',title:'Plan #8712',detail:'Hash Match + Parallelism · avg logical reads 48.7K',state:'1.08s median'}
  ],
  regressions:[
    {name:'AA_URETIM_MALZEME_PLANLAMA',before:'0.94s',now:'284s',delta:'+30,112%',reads:'3.48M',evidence:'A'},
    {name:'AA_ISEMRI_MALZEME_DURUMLARI',before:'1.8s',now:'96s',delta:'+5,233%',reads:'1.92M',evidence:'A'},
    {name:'AA_STOK_HAREKET_OZET',before:'2.4s',now:'18.4s',delta:'+667%',reads:'882K',evidence:'B'},
    {name:'AA_ldrprog_mamulstoklar',before:'1.6s',now:'8.2s',delta:'+413%',reads:'741K',evidence:'A'},
    {name:'AA_URETIM_EMIRLERI',before:'0.7s',now:'2.1s',delta:'+200%',reads:'318K',evidence:'B'}
  ],
  duplicates:[
    {similarity:94,a:'AA_ldrprog_stokrapor',b:'AA_ldrprog_stokrapor2',common:['STOKLAR','STOK_HAREKETLERI','DEPOLAR'],diff:'Warehouse filter'},
    {similarity:91,a:'AA_MALZEME_DURUM',b:'AA_MALZEME_DURUM_YENI',common:['ISEMIRLERI','STOKLAR','URETIM_MALZEME_PLANLAMA'],diff:'Additional status column'},
    {similarity:87,a:'AA_SIPARIS_OZET',b:'AA_SIPARIS_OZET_RAPOR',common:['SIPARISLER','CARI_HESAPLAR'],diff:'Date boundary'},
    {similarity:83,a:'AA_STOK_BAKIYE',b:'AA_STOK_BAKIYE_DEPO',common:['STOK_HAREKETLERI','STOKLAR'],diff:'Depot grouping'}
  ],
  sql:`CREATE VIEW [dbo].[AA_URETIM_MALZEME_PLANLAMA]\nAS\nSELECT\n    a.[Ana İş Emri],\n    a.[İş Kodu],\n    a.[Sipariş No],\n    a.[Ürün Kodu],\n    a.[Ürün Adı],\n    ISNULL(i.[Kalan Miktar], 0) AS [Kalan Miktar],\n    a.Seviye,\n    u.upl_kodu AS [Tüketim Kod],\n    s.sto_isim AS [Tüketim Ad],\n    (u.upl_miktar / NULLIF(u.upl_uret_miktar, 0)) AS [Birim Tüketim]\nFROM dbo.AA_URETIM_AGACI AS a\nLEFT JOIN dbo.AA_ISEMRI_MALZEME_DURUMLARI AS i\n    ON i.[İş Kodu] = a.[İş Kodu]\nLEFT JOIN dbo.URETIM_MALZEME_PLANLAMA AS u\n    ON u.upl_isemri = a.[İş Kodu]\nLEFT JOIN dbo.STOKLAR AS s\n    ON s.sto_kod = u.upl_kodu\n-- Demo source excerpt. Runtime scanner loads full OBJECT_DEFINITION().`
};
