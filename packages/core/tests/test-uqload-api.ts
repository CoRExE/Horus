import { HttpClient } from '../src/utils/HttpClient';

async function test() {
  const http = HttpClient.create('https://fs17.lol');
  const res = await http.get('/engine/ajax/film_api.php?id=15110229');
  console.log("Players:", JSON.stringify(res.data.players, null, 2));
}
test();
