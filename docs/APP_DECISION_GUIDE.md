# XAUGBPEUUSD Strategy App - Panduan Keputusan Sistem

Dokumen ini menjelaskan bagaimana app mengambil keputusan trading untuk `XAUUSD` dan `EURUSD`, bagaimana trade dinyatakan valid atau tidak valid, bagaimana posisi terbuka dipantau, dan bagaimana market scan berjalan.

App ini adalah alat bantu strategi dan eksekusi MT5/Exness. App tidak menjamin profit. Semua eksekusi tetap harus tunduk pada risk guard, demo guard, kondisi MT5, spread, dan validitas SL/TP.

## 1. Sumber Data dan Market yang Dipantau

App membaca data dari terminal MetaTrader 5 lokal. Jika MT5 belum tersedia, sebagian market data dapat jatuh ke mock mode, tetapi eksekusi order tetap diblokir.

Market utama:
- `XAUUSD`
- `EURUSD`

Timeframe yang dipantau:
- `M15`
- `M30`
- `H1`
- `H4`
- `D1`

Timeframe untuk eksekusi otomatis:
- `M15`
- `M30`
- `H1`

`H4` dan `D1` hanya digunakan untuk monitor trend/context. Keduanya tidak dipakai untuk auto execution karena cenderung menghasilkan setup swing dengan SL lebih lebar, holding lebih lama, floating risk lebih besar, dan kebutuhan margin/equity yang lebih berat.

## 2. Bagaimana Market Scan Berjalan

App menjalankan beberapa jenis scan:

1. Realtime tick/watchlist
   - Mengambil bid, ask, mid price, dan spread.
   - Watchlist diperbarui cepat agar harga dan spread tetap hidup.

2. Snapshot market
   - Mengambil candle per symbol/timeframe.
   - Menghitung indikator dan zona harga.
   - Dipakai untuk chart, insight box, dan signal workspace.

3. Signal scan
   - Memindai semua symbol dan semua timeframe.
   - Semua potensi sinyal dengan score minimal `60` dicatat ke dataset signal log.
   - `H4` dan `D1` boleh tercatat sebagai insight/monitoring, tetapi tidak boleh dieksekusi otomatis.

4. Full Auto scan
   - Hanya aktif ketika user menyalakan `Full Auto`.
   - Scan semua market/timeframe, lalu filter kandidat eksekusi hanya `M15`, `M30`, `H1`.
   - Kandidat diurutkan dari score tertinggi.
   - Eksekusi berhenti jika tidak ada sinyal valid atau total risk cap `20%` akan terlampaui.

## 3. Komponen Strategi yang Dinilai

Strategi memberi score berdasarkan confluence dari beberapa komponen:

- EMA/MA trend alignment
- Pullback dekat EMA
- Support/Resistance
- Supply/Demand
- Fibonacci retracement zone
- Quasimodo/QM swing structure
- Candle confirmation
- Spread terhadap batas strategi

Output strategi utama:
- `side`: `BUY`, `SELL`, atau tidak ada arah.
- `orderType`: market atau pending order.
- `entry`
- `stopLoss`
- `takeProfit`
- `score`
- `reasons`
- `blockedReasons`

UI hanya boleh menampilkan satu arah order yang relevan. App tidak boleh menampilkan Buy dan Sell sekaligus sebagai eksekusi utama.

## 4. Bagaimana Trade Dinyatakan Valid

Trade dinyatakan valid jika semua syarat berikut terpenuhi:

- Ada arah jelas: `BUY` atau `SELL`.
- Ada `orderType`, `entry`, `stopLoss`, dan `takeProfit`.
- Confluence score memenuhi minimum strategi, default `60`.
- Spread berada di bawah limit strategi:
  - `XAUUSD`: maksimal `350 points`
  - `EURUSD`: maksimal `18 points`
- SL/TP logis terhadap arah:
  - BUY: `SL < entry < TP`
  - SELL: `TP < entry < SL`
- Lot hasil kalkulasi tidak di bawah minimum broker.
- Risk per trade tidak melewati guard manual default `0.5%`.
- MT5 connected dan trading enabled.
- Demo guard tidak memblokir akun.
- Symbol metadata broker tersedia.

Jika satu saja syarat penting gagal, trade masuk blocked state dan UI menampilkan alasan blokir.

## 5. Bagaimana Trade Dinyatakan Tidak Valid

Trade tidak valid jika terjadi salah satu kondisi berikut:

- Tidak ada trend alignment yang jelas.
- Score di bawah `60`.
- Spread terlalu tinggi.
- Entry, SL, atau TP tidak valid.
- SL/TP berada di sisi yang salah.
- Lot hasil kalkulasi terlalu kecil.
- Risk lebih besar dari limit yang diizinkan.
- MT5 offline.
- AutoTrading/Algo Trading di MT5 OFF.
- Demo guard mendeteksi akun non-demo saat guard ON.
- Ada posisi/order aktif tanpa SL sehingga total risk tidak bisa dihitung aman.
- Untuk Full Auto: timeframe adalah `H4` atau `D1`.

Untuk manual execution, app masih bisa menampilkan warning score rendah dan meminta konfirmasi user. Untuk Full Auto, warning manual tidak berlaku; order hanya boleh terkirim jika semua guard lolos.

## 6. Risk Engine dan Total Risk Cap

Risk dihitung dari jarak entry ke stop loss:

`risk_usd = abs(entry - stopLoss) * contract_size * lot`

Contract size:
- `XAUUSD`: `100`
- `EURUSD`: `100000`

Mode risk yang tersedia:
- Fixed lot
- Fixed USD risk
- Percent equity risk

Default manual risk:
- `0.5%` per trade.
- Maksimum lot per posisi: `0.10`.

Full Auto total risk cap:
- Maksimal `20%` dari equity.
- Menghitung posisi terbuka, pending order, dan kandidat order baru.
- Jika posisi atau pending order tidak punya SL, Full Auto diblokir.
- Order baru hanya boleh dikirim jika total risk setelah order masih `<= 20%`.
- Lot kandidat tetap dicap maksimum `0.10` per posisi sebelum dikirim ke MT5.

## 7. Full Auto Mode

Full Auto adalah mode eksekusi otomatis. Saat ON, order dapat dikirim ke MT5 tanpa modal konfirmasi per order.

Default Full Auto:
- `enabled`: OFF
- `maxTotalRiskPercent`: `20`
- `minScore`: `60`
- `riskMode`: `percent_equity`
- `riskValue`: mengikuti input risk UI saat mode dinyalakan, fallback `0.5`
- `scanIntervalSeconds`: `15`
- `duplicateCooldownMinutes`: `10`

Alur Full Auto:
1. Cek MT5 connected.
2. Cek MT5 trading enabled.
3. Cek demo guard.
4. Hitung total risk aktif.
5. Scan semua market/timeframe.
6. Skip `H4` dan `D1` dari eksekusi.
7. Ambil kandidat valid `M15/M30/H1` dengan score `>= 60`.
8. Sort score tertinggi.
9. Cek duplicate cooldown.
10. Cek total risk setelah kandidat order.
11. Kirim order ke MT5 jika semua valid.

App otomatis mengaktifkan trailing stop ketika floating profit posisi mencapai minimal `$10`. Backend memonitor posisi setiap 1 detik selama service aktif, jadi trailing tidak bergantung pada refresh UI. Close all, close per ticket, manual trailing, dan force close tetap fitur terpisah.

## 8. Validitas Posisi Terbuka

Position card memantau posisi terbuka dari MT5. Selain P/L, lot, open price, SL, dan TP, app juga mengevaluasi apakah setup posisi masih valid. Jika floating profit posisi sudah `>= $10`, background monitor backend mengaktifkan trailing state dan mulai menggeser SL mengikuti peak price.

Validitas posisi dicek terhadap timeframe eksekusi intraday:
- `M15`
- `M30`
- `H1`

Status posisi:

1. Setup masih valid
   - Ada confluence searah dengan posisi.
   - Contoh: posisi BUY dan sinyal valid BUY masih muncul di M15/M30/H1.

2. Setup melemah
   - Tidak ada sinyal searah yang cukup kuat.
   - Belum ada sinyal lawan yang valid.
   - Artinya posisi perlu dimonitor ketat, risk bisa dikurangi, atau trailing bisa dipertimbangkan.

3. Setup posisi tidak valid
   - Ada sinyal valid berlawanan arah.
   - Contoh: posisi BUY terbuka, lalu M15/M30/H1 memberi sinyal SELL valid.
   - App memberi alert. Auto trailing tetap hanya menggeser SL setelah profit `$10`, bukan menutup posisi langsung.

Alert ini membantu user melihat kapan alasan awal membuka posisi sudah melemah atau berubah. Keputusan close karena validitas setup tetap manual; auto close hanya aktif untuk posisi profit `>= $10`.

## 9. Close, Trailing Stop, dan Jurnal

Position card menyediakan:
- Close one active symbol.
- Close per ticket.
- Close all trade.
- Apply trailing stop berdasarkan pips.
- Trading journal.
- Total realized P/L.

Jurnal mencatat:
- Penutupan by TP.
- Penutupan by SL.
- Force close by user dari app.
- Manual external close dari MT5.

Trailing stop:
- Diatur berdasarkan trigger pips, distance pips, dan step pips.
- Hanya memindahkan SL ke arah profit.
- Tidak memperlebar risiko.

## 10. Economic Events

Economic event berasal dari MQL5 Calendar export. Event dipakai sebagai konteks tambahan, bukan sebagai satu-satunya trigger entry.

Jika event berdampak tinggi pada USD, GBP, atau EUR, user perlu memperhatikan spread dan volatilitas. Risk guard tetap menjadi filter utama sebelum eksekusi.

## 11. Prinsip Keputusan Akhir

Sistem mengambil keputusan dengan urutan prioritas berikut:

1. Safety dan risk guard.
2. Koneksi dan izin trading MT5.
3. Spread dan symbol metadata.
4. Validitas entry/SL/TP.
5. Confluence score dan alasan strategi.
6. Timeframe yang boleh dieksekusi.
7. Total risk aktif.
8. Duplicate cooldown.

Jika strategi memberi sinyal bagus tetapi risk guard gagal, order tetap diblokir.

Jika risk masih cukup tetapi setup tidak valid, order tetap diblokir.

Jika posisi terbuka sudah tidak valid, app memberi alert agar user bisa menilai close, reduce risk, atau trailing stop.
