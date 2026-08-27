using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class RaycastImageHelper : MonoBehaviour
{
    // Start is called before the first frame update
    void Start()
    {
        GetComponent<Image>().alphaHitTestMinimumThreshold = 1f; // or anything > 0
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
