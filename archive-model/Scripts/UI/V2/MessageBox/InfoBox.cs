using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class InfoBox : MonoBehaviour
{

    public TextMeshProUGUI text;


    public void SetText(string message)
    {
        text.text = message;
    }

    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
