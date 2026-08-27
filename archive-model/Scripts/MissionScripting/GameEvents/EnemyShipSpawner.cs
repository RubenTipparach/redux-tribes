using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EnemyShipSpawner : MonoBehaviour
{


    // spawn N number of ships based on this list.
    public List<ShipCardData> cardData;


    public void SpawnShips(){
            // add a bunch of ships/

            Vector3 offset = Vector3.right * 40;
            int i = 0;
            foreach(var s in cardData)
            {

                var ship = Instantiate(s.shipSpawner, transform.position + offset * i, transform.rotation);
                GameManager.Instance.uiController.SetupShipUI(ship);

                i++;
            }
                
    }
    
    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        // if (Input.GetKeyDown(KeyCode.Space))
        // {
        //     SpawnShips();
        // }
    }
}
