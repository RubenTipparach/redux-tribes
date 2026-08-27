using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class LoadDialog : MonoBehaviour
{
    DialogManager dialogManager;
    // Start is called before the first frame update
    void Start()
    {
        dialogManager = GetComponent<DialogManager>();
        dialogManager.BeginSequence();
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
