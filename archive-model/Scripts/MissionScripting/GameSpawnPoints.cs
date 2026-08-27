using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class GameSpawnPoints : MonoBehaviour
{

    public Transform[] playerSpawnPoints;

    public Transform[] enemySpawnPoints;

    public Vector3 playerOffset;
    public Vector3 enemyOffset;
    
    public float spawnVizSize = 5;

    public ShipFaction defaultShipFaction;

    public SpawnParams GetNextOffset(int i, bool player = false)
    {
        var SpawnParams = new SpawnParams();
        var array = player ? playerSpawnPoints : enemySpawnPoints;
        if (i > array.Length - 1)
        {
            SpawnParams.position = array[0].position + array[0].rotation * playerOffset * i;
            SpawnParams.rotation = array[0].rotation;
        }
        else
        {
            SpawnParams.position = array[i].position;
            SpawnParams.rotation = array[i].rotation;
        }

        return SpawnParams;
    }



    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }

#if UNITY_EDITOR
    void OnDrawGizmos(){
        if (playerSpawnPoints.Length > 0 && enemySpawnPoints.Length > 0)
        {
            Gizmos.color = Color.white;
            Gizmos.DrawLine(playerSpawnPoints[0].position, transform.position);

            Gizmos.DrawWireCube(transform.position, Vector3.one * 5);


            Gizmos.color = Color.green;
            Gizmos.matrix = playerSpawnPoints[0].localToWorldMatrix;

            Gizmos.DrawWireCube(Vector3.zero, Vector3.one * spawnVizSize);
            Gizmos.DrawWireCube(Vector3.forward * spawnVizSize + Vector3.forward, Vector3.one * spawnVizSize / 2f + Vector3.forward * spawnVizSize);

            foreach (var e in enemySpawnPoints)
            {
                Gizmos.color = Color.red;
                Gizmos.matrix = e.localToWorldMatrix;

                Gizmos.DrawWireCube(Vector3.zero, Vector3.one * spawnVizSize);
                Gizmos.DrawWireCube(Vector3.forward * spawnVizSize + Vector3.forward, Vector3.one * spawnVizSize / 2f + Vector3.forward * spawnVizSize); 
                Gizmos.color = Color.white;

                Gizmos.matrix = Matrix4x4.identity;
                Gizmos.DrawLine(e.position, transform.position);
                
            }
            
        }
    }
#endif

}
public class SpawnParams{
    public Vector3 position;
    public Quaternion rotation;
}