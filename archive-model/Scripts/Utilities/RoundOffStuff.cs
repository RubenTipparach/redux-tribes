using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[ExecuteInEditMode]
public class RoundOffStuff : MonoBehaviour
{
    public bool refresh = false;
    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
        if(refresh)
        {
            refresh = false;

            foreach(Transform t in transform)
            {
                t.position = new Vector3(Mathf.Round(t.position.x), t.position.y, Mathf.Round(t.position.z));
            }
        }
    }
}
